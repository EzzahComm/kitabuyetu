/**
 * Migration 169 proof — an organization coordinator can read the group-scoped
 * tables their portfolio is built from, and ONLY for groups their organization
 * actively links.
 *
 * Why this suite and not the ordinary integration run: a coordinator holds no
 * group, so `app.current_group_id` is the empty-string sentinel and
 * `app_current_group_id()` returns NULL. Every pre-169 policy on these tables
 * was `group_id = app_current_group_id()`, which is NULL — not false — for every
 * row, so nothing passed. Against the BYPASSRLS admin pool that filtering never
 * happens and these tests would pass for the wrong reason, which is exactly how
 * the bug reached main: the ordinary suite was 482/482 green while the
 * app_tenant run failed.
 *
 * The four tables are the ones the organization read surface actually touches
 * through withDb and that had no coordinator arm: group_members, members,
 * loan_repayments, subscriptions. `accounts` is deliberately absent — it is read
 * only inside settleOrgDisbursement, which uses withAdminDb and so bypasses RLS.
 *
 * Each table is proved in both directions. A test that only shows the
 * coordinator CAN now read would equally pass a policy of `USING (true)`.
 */
import { withDb, type TenantContext } from '@/lib/db';
import { createTestGroup, createTestOrganization } from '../helpers/fixtures';
import { resetDatabase } from '../helpers/cleanup';
import { rawQuery } from '../helpers/db';
import { assignGroupToOrganization } from '@/lib/services/admin-organizations.service';

/** A coordinator's real request context: no group, an organization instead. */
const coordinatorCtx = (userId: string, organizationId: string): TenantContext => ({
  userId,
  groupId: '',
  role: 'organization_coordinator',
  organizationId,
});

describe('migration 169 — organization coordinator reads under app_tenant', () => {
  let orgId: string, coordinatorId: string;
  let otherOrgId: string, otherCoordinatorId: string;
  // linked: granted to orgId. unlinked: exists, never granted to anyone.
  let linkedGroupId: string, linkedOfficerId: string;
  let unlinkedGroupId: string, unlinkedOfficerId: string;
  // revoked: granted then deactivated — is_active = false.
  let revokedGroupId: string;

  beforeAll(async () => {
    await resetDatabase();

    ({ organizationId: orgId, coordinatorId } = await createTestOrganization());
    ({ organizationId: otherOrgId, coordinatorId: otherCoordinatorId } =
      await createTestOrganization());

    ({ groupId: linkedGroupId, officerId: linkedOfficerId } = await createTestGroup(
      'chairperson',
      { subscribed: true },
    ));
    ({ groupId: unlinkedGroupId, officerId: unlinkedOfficerId } = await createTestGroup(
      'chairperson',
      { subscribed: true },
    ));
    ({ groupId: revokedGroupId } = await createTestGroup('chairperson', { subscribed: true }));

    await assignGroupToOrganization(orgId, linkedGroupId, coordinatorId, 'read');
    await assignGroupToOrganization(orgId, revokedGroupId, coordinatorId, 'read');
    await rawQuery(`UPDATE organization_group_access SET is_active = false WHERE group_id = $1`, [
      revokedGroupId,
    ]);

    // A repayment on the linked group and one on the unlinked group, so the
    // loan_repayments assertions below can distinguish "filtered correctly"
    // from "there was only ever one row".
    for (const [gid, mid] of [
      [linkedGroupId, linkedOfficerId],
      [unlinkedGroupId, unlinkedOfficerId],
    ]) {
      await rawQuery(
        `WITH fs AS (
           INSERT INTO group_funding_sources (group_id, source_type, label)
           VALUES ($1, 'other', 'Test source')
           RETURNING id
         ), l AS (
           INSERT INTO loans (group_id, member_id, group_membership_id, principal_amount,
                              interest_rate, loan_term_months, status)
           SELECT $1, $2, gm.id, 10000, 5, 6, 'active'
           FROM group_members gm WHERE gm.group_id = $1 AND gm.member_id = $2
           RETURNING id
         ), sp AS (
           INSERT INTO loan_funding_splits (loan_id, funding_source_id, amount)
           SELECT l.id, fs.id, 10000 FROM l, fs RETURNING loan_id
         )
         INSERT INTO loan_repayments (loan_id, group_id, amount_paid, status, payment_date)
         SELECT l.id, $1, 500, 'completed', CURRENT_DATE FROM l`,
        [gid, mid],
      );
    }
  });

  afterAll(async () => {
    await resetDatabase();
  });

  it('is actually connected as app_tenant (no BYPASSRLS) — not the admin pool', async () => {
    const [role] = await withDb(coordinatorCtx(coordinatorId, orgId), async (c) => {
      const { rows } = await c.query<{ rolname: string; rolbypassrls: boolean; rolsuper: boolean }>(
        'SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user',
      );
      return rows;
    });
    expect(role.rolname).toBe('app_tenant');
    expect(role.rolbypassrls).toBe(false);
    expect(role.rolsuper).toBe(false);
  });

  it('confirms the coordinator really has no group context (the NULL that broke every policy)', async () => {
    const [ctx] = await withDb(coordinatorCtx(coordinatorId, orgId), async (c) => {
      const { rows } = await c.query<{ gid: string | null; oid: string | null; role: string }>(
        `SELECT app_current_group_id() AS gid,
                app_current_organization_id() AS oid,
                app_current_role() AS role`,
      );
      return rows;
    });
    expect(ctx.gid).toBeNull();
    expect(ctx.oid).toBe(orgId);
    expect(ctx.role).toBe('organization_coordinator');
  });

  // ── group_members — the table that broke PRs #151, #154 and #155 ──────────
  it('sees group_members of a linked group, and no others, on a WHERE-less SELECT', async () => {
    const rows = await withDb(coordinatorCtx(coordinatorId, orgId), async (c) => {
      const { rows } = await c.query<{ group_id: string }>('SELECT group_id FROM group_members');
      return rows;
    });

    expect(rows.length).toBeGreaterThan(0);
    // The whole point: Postgres did the filtering, not a service WHERE clause.
    expect(new Set(rows.map((r) => r.group_id))).toEqual(new Set([linkedGroupId]));
  });

  it('sees group_members of an inactive membership too (portfolio health counts them)', async () => {
    await rawQuery(`UPDATE group_members SET is_active = false WHERE group_id = $1`, [
      linkedGroupId,
    ]);
    try {
      const rows = await withDb(coordinatorCtx(coordinatorId, orgId), async (c) => {
        const { rows } = await c.query('SELECT id FROM group_members');
        return rows;
      });
      // The arm must not filter on gm.is_active, or "inactive members" reads 0 —
      // which is the exact assertion portfolio-health.test.ts failed on.
      expect(rows.length).toBeGreaterThan(0);
    } finally {
      await rawQuery(`UPDATE group_members SET is_active = true WHERE group_id = $1`, [
        linkedGroupId,
      ]);
    }
  });

  it('cannot see group_members once the organization link is deactivated', async () => {
    const rows = await withDb(coordinatorCtx(coordinatorId, orgId), async (c) => {
      const { rows } = await c.query<{ group_id: string }>(
        'SELECT group_id FROM group_members WHERE group_id = $1',
        [revokedGroupId],
      );
      return rows;
    });
    expect(rows).toHaveLength(0);
  });

  it("cannot see another organization's group_members", async () => {
    const rows = await withDb(coordinatorCtx(otherCoordinatorId, otherOrgId), async (c) => {
      const { rows } = await c.query('SELECT group_id FROM group_members');
      return rows;
    });
    // otherOrg links nothing at all.
    expect(rows).toHaveLength(0);
  });

  // ── members — reached through the membership, no group_id of its own ───────
  it('sees members of linked groups only', async () => {
    const rows = await withDb(coordinatorCtx(coordinatorId, orgId), async (c) => {
      const { rows } = await c.query<{ id: string }>('SELECT id FROM members');
      return rows;
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(linkedOfficerId);
    expect(ids).not.toContain(unlinkedOfficerId);
  });

  // ── loan_repayments — getDashboard's loans_repaid read 0 without this ──────
  it('sees loan_repayments of linked groups only', async () => {
    const rows = await withDb(coordinatorCtx(coordinatorId, orgId), async (c) => {
      const { rows } = await c.query<{ group_id: string }>(
        'SELECT group_id FROM loan_repayments',
      );
      return rows;
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.group_id))).toEqual(new Set([linkedGroupId]));
  });

  // ── subscriptions — plan read as NULL via LEFT JOIN LATERAL without this ──
  it('sees subscriptions of linked groups only', async () => {
    const rows = await withDb(coordinatorCtx(coordinatorId, orgId), async (c) => {
      const { rows } = await c.query<{ group_id: string }>('SELECT group_id FROM subscriptions');
      return rows;
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.group_id))).toEqual(new Set([linkedGroupId]));
  });

  it('did NOT gain write access to subscriptions (the ALL policy was left alone)', async () => {
    // subscriptions carries a single FOR ALL policy; 169 adds a separate FOR
    // SELECT policy rather than widening it, so reads open and writes stay shut.
    await expect(
      withDb(coordinatorCtx(coordinatorId, orgId), (c) =>
        c.query(`UPDATE subscriptions SET status = 'cancelled' WHERE group_id = $1`, [
          linkedGroupId,
        ]),
      ),
    ).rejects.toThrow();
  });

  // ── no widening for anyone else ───────────────────────────────────────────
  it("leaves an ordinary group officer's visibility unchanged", async () => {
    const rows = await withDb(
      { userId: linkedOfficerId, groupId: linkedGroupId, role: 'chairperson' },
      async (c) => {
        const { rows } = await c.query<{ group_id: string }>('SELECT group_id FROM group_members');
        return rows;
      },
    );
    // Still exactly their own group — the new arm requires the coordinator role.
    expect(new Set(rows.map((r) => r.group_id))).toEqual(new Set([linkedGroupId]));
  });

  it('does not let a non-coordinator borrow the coordinator arm by claiming an organization', async () => {
    // A group officer whose context also carries an organizationId must gain
    // nothing: the arm is gated on app_current_role(), and proxy.ts re-stamps
    // role from the verified JWT, so this is the shape of a forged claim.
    const rows = await withDb(
      {
        userId: linkedOfficerId,
        groupId: linkedGroupId,
        role: 'chairperson',
        organizationId: orgId,
      },
      async (c) => {
        const { rows } = await c.query<{ group_id: string }>(
          'SELECT group_id FROM group_members WHERE group_id = $1',
          [revokedGroupId],
        );
        return rows;
      },
    );
    expect(rows).toHaveLength(0);
  });
});
