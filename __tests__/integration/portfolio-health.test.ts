/**
 * Portfolio health indicators — GET /api/admin/organization/health.
 *
 * The §1.5 "what needs attention?" layer. Three things are worth asserting and
 * the third is the easiest to get wrong:
 *
 * 1. Arrears are actually detected at all.
 * 2. They are not inflated by fan-out — the group here carries THREE members
 *    against ONE overdue loan, so a flat join of loans to group_members would
 *    report 3 (the PR #105 class, 99x on real data).
 * 3. A percentage over an empty denominator is NULL, not 0. "0% of loans are
 *    overdue" and "there are no loans to assess" are different statements, and
 *    rendering the second as the first is the same dishonesty R10 names for
 *    money.
 */
import { GET as healthGet } from '@/app/api/admin/organization/health/route';
import { backofficeHeaders, buildRequest } from './helpers/request';
import { createTestOrganization, createTestGroup, addGroupOfficer } from './helpers/fixtures';
import { rawQuery } from './helpers/db';
import { resetDatabase } from './helpers/cleanup';
import { assignGroupToOrganization } from '@/lib/services/admin-organizations.service';

interface Health {
  linkedGroups: number; activeLoans: number;
  overdueLoans: number; overdueOutstanding: string; overdueLoanPct: number | null;
  groupsInArrears: number; groupsInArrearsPct: number | null;
  defaultedLoans: number; defaultedOutstanding: string;
  inactiveMembers: number; newMembers30d: number;
}
interface Body { health: Health | null; incomplete: string[] }

const call = (userId: string, organizationId: string) =>
  healthGet(buildRequest('/api/admin/organization/health', {
    headers: backofficeHeaders({ userId, platformRole: 'organization_coordinator', organizationId }),
  }));

const PRINCIPAL = 50_000;

/**
 * Inserts a loan already past its next payment date, still active.
 *
 * All three rows go in ONE statement deliberately. Migration 118 enforces that
 * loan_funding_splits sum to the principal — "every disbursed loan must be fully
 * attributed to its funding sources" — via a DEFERRED constraint that fires at
 * COMMIT. rawQuery wraps each call in its own transaction, so inserting the loan
 * and its split separately trips the check on the first COMMIT. A single
 * statement with CTEs keeps them in one transaction.
 */
async function addOverdueLoan(groupId: string, memberId: string, outstanding: number) {
  const [gm] = await rawQuery<{ id: string }>(
    `SELECT id FROM group_members WHERE group_id = $1 AND member_id = $2 LIMIT 1`,
    [groupId, memberId],
  );
  await rawQuery(
    // Find-or-create the internal-savings source: uq_group_funding_sources_internal
    // allows a group exactly one, and createTestGroup already seeds it.
    `WITH existing AS (
       SELECT id FROM group_funding_sources
       WHERE group_id = $1 AND source_type = 'internal_savings' LIMIT 1
     ), ins AS (
       INSERT INTO group_funding_sources (group_id, source_type, label)
       SELECT $1, 'internal_savings', 'Test internal savings'
       WHERE NOT EXISTS (SELECT 1 FROM existing)
       RETURNING id
     ), fs AS (
       SELECT id FROM existing UNION ALL SELECT id FROM ins
     ), l AS (
       INSERT INTO loans
         (group_id, member_id, group_membership_id, principal_amount, interest_rate,
          loan_term_months, status, outstanding_balance, next_payment_date)
       VALUES ($1, $2, $3, $4, 12, 12, 'active', $5, CURRENT_DATE - INTERVAL '10 days')
       RETURNING id
     )
     INSERT INTO loan_funding_splits (group_id, loan_id, funding_source_id, amount)
     SELECT $1, l.id, fs.id, $4 FROM l, fs`,
    [groupId, memberId, gm.id, PRINCIPAL, outstanding],
  );
}

describe('Portfolio health indicators', () => {
  beforeAll(async () => { await resetDatabase(); });
  afterAll(async ()  => { await resetDatabase(); });

  it('detects arrears without inflating them by member count', async () => {
    const { organizationId, coordinatorId } = await createTestOrganization();
    const { groupId, officerId } = await createTestGroup();
    // Three members, one overdue loan. A fan-out regression reports 3.
    await addGroupOfficer(groupId, officerId, 'treasurer');
    await addGroupOfficer(groupId, officerId, 'secretary');
    await assignGroupToOrganization(organizationId, groupId, coordinatorId, 'read');
    await addOverdueLoan(groupId, officerId, 40_000);

    const res = await call(coordinatorId, organizationId);
    expect(res.status).toBe(200);
    const { data } = await res.json() as { data: Body };

    expect(data.incomplete).toEqual([]);
    expect(data.health).not.toBeNull();
    const h = data.health!;

    expect(h.overdueLoans).toBe(1);              // not 3
    expect(h.activeLoans).toBe(1);
    expect(parseFloat(h.overdueOutstanding)).toBe(40_000);
    expect(h.groupsInArrears).toBe(1);
    expect(h.linkedGroups).toBe(1);
    expect(h.overdueLoanPct).toBe(100);
    expect(h.groupsInArrearsPct).toBe(100);
  });

  it('reports an empty denominator as null, never as 0%', async () => {
    const { organizationId, coordinatorId } = await createTestOrganization();

    const { data } = await (await call(coordinatorId, organizationId)).json() as { data: Body };

    // Nothing failed, so the section is present with genuine zeros...
    expect(data.incomplete).toEqual([]);
    expect(data.health).not.toBeNull();
    expect(data.health!.activeLoans).toBe(0);

    // ...but the RATES must be null. Saying "0% overdue" about an organization
    // with no loans asserts a clean portfolio that was never assessed.
    expect(data.health!.overdueLoanPct).toBeNull();
    expect(data.health!.groupsInArrearsPct).toBeNull();
  });

  it("does not count another organization's arrears", async () => {
    const a = await createTestOrganization();
    const b = await createTestOrganization();
    const { groupId, officerId } = await createTestGroup();
    await assignGroupToOrganization(a.organizationId, groupId, a.coordinatorId, 'read');
    await addOverdueLoan(groupId, officerId, 25_000);

    const { data } = await (await call(b.coordinatorId, b.organizationId)).json() as { data: Body };

    expect(data.health).not.toBeNull();
    expect(data.health!.overdueLoans).toBe(0);
    expect(data.health!.linkedGroups).toBe(0);
    expect(parseFloat(data.health!.overdueOutstanding)).toBe(0);
  });

  it('counts recent joins and currently-inactive members', async () => {
    const { organizationId, coordinatorId } = await createTestOrganization();
    const { groupId, officerId } = await createTestGroup();
    const secondId = await addGroupOfficer(groupId, officerId, 'treasurer');
    await assignGroupToOrganization(organizationId, groupId, coordinatorId, 'read');

    await rawQuery(
      `UPDATE group_members SET is_active = false WHERE group_id = $1 AND member_id = $2`,
      [groupId, secondId],
    );

    const { data } = await (await call(coordinatorId, organizationId)).json() as { data: Body };
    const h = data.health!;

    expect(h.inactiveMembers).toBe(1);
    // The fixture just created them, so they fall inside the 30-day window.
    expect(h.newMembers30d).toBeGreaterThanOrEqual(1);
  });
});
