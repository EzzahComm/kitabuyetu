/**
 * Programme tier of the portfolio drill-down —
 * GET /api/admin/organization/programs/:id/groups.
 *
 * Two things this file exists to prove, in order of how expensive they are to
 * get wrong:
 *
 * 1. CROSS-TENANT. A coordinator of organization B asking for organization A's
 *    program must get 404 — not 403, and above all not rows. 404 rather than
 *    403 because a 403 confirms the id exists somewhere, which is itself a
 *    cross-tenant disclosure.
 *
 * 2. FAN-OUT. The per-group figures join disbursements and members for the same
 *    group. Done with a naive join, every disbursement row multiplies by every
 *    member row — the 99x inflation fixed in PR #105 (admin.service getGroupById)
 *    and again in admin-geography's county rollup. A single-member group cannot
 *    detect that bug, so the group here deliberately has three members: a
 *    regression would report 30,000 against a 10,000 disbursement.
 */
import { GET as programGroupsGet } from '@/app/api/admin/organization/programs/[id]/groups/route';
import { backofficeHeaders, buildRequest } from './helpers/request';
import { createTestOrganization, createTestGroup, addGroupOfficer } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { assignGroupToOrganization } from '@/lib/services/admin-organizations.service';
import { organizationFinanceService } from '@/lib/services/organization-finance.service';
import type { TenantContext } from '@/lib/db';

const DISBURSED = 10_000;   // below the 50,000 maker-checker threshold on purpose
const RESERVED  = 60_000;   // above it on purpose — parks at 'pending_approval'

interface GroupLine {
  group_id: string; group_name: string;
  disbursed: string; reserved: string;
  disbursement_count: number; active_members: number;
}

describe('Funding-program group drill-down', () => {
  let orgA = '', coordA = '', orgB = '', coordB = '';
  let groupId = '', programId = '';

  const call = (id: string, headers: Record<string, string>) =>
    programGroupsGet(
      buildRequest(`/api/admin/organization/programs/${id}/groups`, { headers }),
      { params: Promise.resolve({ id }) },
    );

  beforeAll(async () => {
    await resetDatabase();
    ({ organizationId: orgA, coordinatorId: coordA } = await createTestOrganization());
    ({ organizationId: orgB, coordinatorId: coordB } = await createTestOrganization());

    const group = await createTestGroup();
    groupId = group.groupId;
    // Three active members, so a fan-out regression is actually detectable.
    await addGroupOfficer(groupId, group.officerId, 'treasurer');
    await addGroupOfficer(groupId, group.officerId, 'secretary');

    await assignGroupToOrganization(orgA, groupId, coordA, 'read');

    // Writes use a ctx carrying the real groupId, matching what
    // createTestOrgDisbursement does — settlement posts a journal entry into
    // the GROUP's books, so the group-scoped path has to resolve.
    const ctx: TenantContext = {
      userId: coordA, groupId, role: 'organization_coordinator', organizationId: orgA,
    };
    await organizationFinanceService.getWallet(ctx);   // lazily bootstraps the wallet row
    await organizationFinanceService.deposit(ctx, { amount: 1_000_000, source: 'Integration test funding' });

    const program = await organizationFinanceService.createProgram(ctx, {
      name: 'Drill-down Test Grant', programType: 'grant', budget: 500_000,
    });
    programId = program.id;

    await organizationFinanceService.disburse(ctx, {
      groupId, amount: DISBURSED, disbursementType: 'grant', fundingProgramId: programId,
    });
    await organizationFinanceService.disburse(ctx, {
      groupId, amount: RESERVED, disbursementType: 'grant', fundingProgramId: programId,
    });
  });

  afterAll(async () => {
    await resetDatabase();
  });

  // ── Authorization boundaries ──────────────────────────────────────────────

  it('denies a non-organization platform role', async () => {
    const res = await call(programId, backofficeHeaders({
      userId: coordA, platformRole: 'support', organizationId: orgA,
    }));
    expect(res.status).toBe(403);
  });

  it("returns 404 — not 403, and no rows — for another organization's program", async () => {
    const res = await call(programId, backofficeHeaders({
      userId: coordB, platformRole: 'organization_coordinator', organizationId: orgB,
    }));
    expect(res.status).toBe(404);

    // Belt and braces: whatever the body is, it must not carry the group.
    expect(JSON.stringify(await res.json())).not.toContain(groupId);
  });

  it('rejects a malformed program id at the boundary rather than in Postgres', async () => {
    const res = await call('not-a-uuid', backofficeHeaders({
      userId: coordA, platformRole: 'organization_coordinator', organizationId: orgA,
    }));
    // 422, not 400: handleError maps ZodError -> VALIDATION_ERROR/422
    // (lib/utils/response.ts). Without the boundary schema this id would reach
    // `WHERE id = $1` against a uuid column and surface as a Postgres cast
    // error — a 500 for what is plainly a client mistake.
    expect(res.status).toBe(422);
  });

  // ── Money paths ───────────────────────────────────────────────────────────

  it('does NOT inflate disbursed by member count (fan-out regression guard)', async () => {
    const res = await call(programId, backofficeHeaders({
      userId: coordA, platformRole: 'organization_coordinator', organizationId: orgA,
    }));
    expect(res.status).toBe(200);

    const { data } = await res.json() as { data: { groups: GroupLine[]; incomplete: string[] } };
    const line = data.groups.find(g => g.group_id === groupId);
    expect(line).toBeDefined();

    // The group really does have several members — otherwise this test proves
    // nothing about fan-out.
    expect(line!.active_members).toBeGreaterThan(1);

    expect(parseFloat(line!.disbursed)).toBe(DISBURSED);
    expect(line!.disbursement_count).toBe(1);
  });

  it("counts only settled money as disbursed, and pending approval as reserved", async () => {
    const res = await call(programId, backofficeHeaders({
      userId: coordA, platformRole: 'organization_coordinator', organizationId: orgA,
    }));
    const { data } = await res.json() as { data: { groups: GroupLine[] } };
    const line = data.groups.find(g => g.group_id === groupId)!;

    // The 60,000 exceeded the maker-checker threshold, so it is authorised-
    // pending, not money that has moved. It must never be added to disbursed.
    expect(parseFloat(line.reserved)).toBe(RESERVED);
    expect(parseFloat(line.disbursed)).toBe(DISBURSED);
  });

  it('reconciles with the program header — per-group disbursed sums to disbursed_total', async () => {
    const res = await call(programId, backofficeHeaders({
      userId: coordA, platformRole: 'organization_coordinator', organizationId: orgA,
    }));
    const { data } = await res.json() as {
      data: { program: { disbursed_total: string }; groups: GroupLine[]; incomplete: string[] };
    };

    const summed = data.groups.reduce((acc, g) => acc + parseFloat(g.disbursed), 0);
    expect(summed).toBe(parseFloat(data.program.disbursed_total));

    // R10 — nothing degraded on the happy path, so no metric may be flagged.
    expect(data.incomplete).toEqual([]);
  });
});
