/**
 * Regression coverage for migration 122 (DB_PERFORMANCE_ADVISOR_AUDIT_2026-08.md
 * F1): 21 tables had their "select + FOR ALL" policy pair split into
 * "select + insert + update + delete" to stop Postgres from redundantly
 * evaluating two permissive policies on every SELECT. None of these 25
 * tables had any RLS-enforcement coverage before this file — every existing
 * test either used the BYPASSRLS admin pool (which cannot catch a mistake in
 * the policy text at all) or exercised service-layer `WHERE group_id = ...`
 * logic, not Postgres's own policy evaluation. See rls-enforcement.test.ts
 * for the pattern this file follows (two groups, assert cross-tenant
 * invisibility with no WHERE clause) — same app_tenant-only config.
 *
 * Covers one representative table per handling group from the migration,
 * not all 21 individually: Group 1a (group-scoped, role-gated write) via
 * share_classes, Group 1b (global reference data) via
 * mpesa_b2c_charge_tiers, Group 2 (redundant-policy drop) via
 * idempotency_keys, Group 3 (merged two-axis SELECT) via
 * organization_disbursements and sms_usage_logs.
 */
import { withDb, type TenantContext } from '@/lib/db';
import {
  createTestGroup,
  addGroupOfficer,
  createTestOrganization,
  createTestOrgDisbursement,
} from '../helpers/fixtures';
import { resetDatabase } from '../helpers/cleanup';
import { rawQuery } from '../helpers/db';

describe('RLS policy consolidation (migration 122) — real Postgres, no service-layer WHERE clause', () => {
  afterEach(async () => {
    await resetDatabase();
  });

  describe('Group 1a representative: share_classes (group-scoped, role-gated write)', () => {
    it('SELECT is cross-tenant isolated with no WHERE clause', async () => {
      const { groupId: groupAId, officerId } = await createTestGroup('treasurer');
      const { groupId: groupBId } = await createTestGroup('treasurer');

      const [classA] = await rawQuery<{ id: string }>(
        `INSERT INTO share_classes (group_id, name, code, par_value) VALUES ($1, 'Ordinary', 'ORD', 100)
         RETURNING id`,
        [groupAId],
      );
      await rawQuery(
        `INSERT INTO share_classes (group_id, name, code, par_value) VALUES ($1, 'Ordinary', 'ORD', 100)`,
        [groupBId],
      );

      const ctx: TenantContext = { userId: officerId, groupId: groupAId, role: 'treasurer' };
      const rows = await withDb(ctx, (client) => client.query('SELECT id FROM share_classes').then(r => r.rows));

      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(classA.id);
    });

    it('INSERT is rejected for a plain member and accepted for treasurer', async () => {
      const { groupId, officerId: treasurerId } = await createTestGroup('treasurer');
      const memberId = await addGroupOfficer(groupId, treasurerId, 'member');

      const memberCtx: TenantContext = { userId: memberId, groupId, role: 'member' };
      await expect(
        withDb(memberCtx, (client) =>
          client.query(`INSERT INTO share_classes (group_id, name, code, par_value) VALUES ($1, 'X', 'X', 1)`, [groupId]),
        ),
      ).rejects.toThrow(/row-level security/i);

      const treasurerCtx: TenantContext = { userId: treasurerId, groupId, role: 'treasurer' };
      const { rows } = await withDb(treasurerCtx, (client) =>
        client.query<{ id: string }>(
          `INSERT INTO share_classes (group_id, name, code, par_value) VALUES ($1, 'Ordinary', 'ORD', 100) RETURNING id`,
          [groupId],
        ),
      );
      expect(rows).toHaveLength(1);
    });

    it('DELETE affects 0 rows for a plain member and 1 row for treasurer (USING failure is silent, not an error)', async () => {
      const { groupId, officerId: treasurerId } = await createTestGroup('treasurer');
      const memberId = await addGroupOfficer(groupId, treasurerId, 'member');
      const [{ id: classId }] = await rawQuery<{ id: string }>(
        `INSERT INTO share_classes (group_id, name, code, par_value) VALUES ($1, 'Ordinary', 'ORD', 100) RETURNING id`,
        [groupId],
      );

      const memberCtx: TenantContext = { userId: memberId, groupId, role: 'member' };
      const memberResult = await withDb(memberCtx, (client) =>
        client.query('DELETE FROM share_classes WHERE id = $1', [classId]),
      );
      expect(memberResult.rowCount).toBe(0);

      const treasurerCtx: TenantContext = { userId: treasurerId, groupId, role: 'treasurer' };
      const treasurerResult = await withDb(treasurerCtx, (client) =>
        client.query('DELETE FROM share_classes WHERE id = $1', [classId]),
      );
      expect(treasurerResult.rowCount).toBe(1);
    });
  });

  describe('Group 1b representative: mpesa_b2c_charge_tiers (global reference data, admin-only write)', () => {
    it('SELECT works for any authenticated role', async () => {
      const { groupId, officerId: treasurerId } = await createTestGroup('treasurer');
      const memberId = await addGroupOfficer(groupId, treasurerId, 'member');
      await rawQuery(
        `INSERT INTO mpesa_b2c_charge_tiers (min_amount, max_amount, charge) VALUES (0, 100, 5)`,
      );

      const ctx: TenantContext = { userId: memberId, groupId, role: 'member' };
      const rows = await withDb(ctx, (client) => client.query('SELECT id FROM mpesa_b2c_charge_tiers').then(r => r.rows));
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });

    it('write is rejected for a non-admin role and accepted for super_admin', async () => {
      const { groupId, officerId } = await createTestGroup('chairperson');

      const officerCtx: TenantContext = { userId: officerId, groupId, role: 'chairperson' };
      await expect(
        withDb(officerCtx, (client) =>
          client.query(`INSERT INTO mpesa_b2c_charge_tiers (min_amount, max_amount, charge) VALUES (0, 100, 5)`),
        ),
      ).rejects.toThrow(/row-level security/i);

      const adminCtx: TenantContext = { userId: officerId, groupId, role: 'super_admin' };
      const { rows } = await withDb(adminCtx, (client) =>
        client.query<{ id: string }>(
          `INSERT INTO mpesa_b2c_charge_tiers (min_amount, max_amount, charge) VALUES (0, 100, 5) RETURNING id`,
        ),
      );
      expect(rows).toHaveLength(1);
    });
  });

  describe('Group 2: idempotency_keys (member-scoped, not group-scoped — redundant duplicate policy dropped)', () => {
    it('SELECT with no WHERE clause returns only the caller’s own key', async () => {
      const { groupId, officerId: memberA } = await createTestGroup('treasurer');
      const memberB = await addGroupOfficer(groupId, memberA, 'member');

      await rawQuery(
        `INSERT INTO idempotency_keys (key, endpoint, member_id, request_hash, response_status, response_body, expires_at)
         VALUES ($1, '/test', $2, 'hash-a', 200, '{}'::jsonb, now() + interval '1 hour')`,
        ['key-a', memberA],
      );
      await rawQuery(
        `INSERT INTO idempotency_keys (key, endpoint, member_id, request_hash, response_status, response_body, expires_at)
         VALUES ($1, '/test', $2, 'hash-b', 200, '{}'::jsonb, now() + interval '1 hour')`,
        ['key-b', memberB],
      );

      const ctx: TenantContext = { userId: memberA, groupId, role: 'treasurer' };
      const rows = await withDb(ctx, (client) => client.query<{ key: string }>('SELECT key FROM idempotency_keys').then(r => r.rows));

      expect(rows).toHaveLength(1);
      expect(rows[0].key).toBe('key-a');
    });
  });

  describe('Group 3a: organization_disbursements (org-coordinator axis + group-member axis merged into one SELECT)', () => {
    it('both the org-coordinator path and the group-member path independently grant SELECT; an unrelated group sees nothing; a non-coordinator group member cannot INSERT', async () => {
      const { organizationId, coordinatorId } = await createTestOrganization();
      const { groupId: groupAId, officerId: groupAOfficerId } = await createTestGroup('treasurer');
      const { groupId: groupBId, officerId: groupBOfficerId } = await createTestGroup('treasurer');
      const groupAMemberId = await addGroupOfficer(groupAId, groupAOfficerId, 'member');

      const disb = await createTestOrgDisbursement(organizationId, coordinatorId, groupAId);

      // Org-coordinator axis
      const coordinatorCtx: TenantContext = {
        userId: coordinatorId, groupId: groupAId, role: 'organization_coordinator', organizationId,
      };
      const coordinatorRows = await withDb(coordinatorCtx, (client) =>
        client.query<{ id: string }>('SELECT id FROM organization_disbursements').then(r => r.rows),
      );
      expect(coordinatorRows.map(r => r.id)).toContain(disb.id);

      // Group-member axis — a plain member of group A, with NO organization role at all
      const groupMemberCtx: TenantContext = { userId: groupAMemberId, groupId: groupAId, role: 'member' };
      const groupMemberRows = await withDb(groupMemberCtx, (client) =>
        client.query<{ id: string }>('SELECT id FROM organization_disbursements').then(r => r.rows),
      );
      expect(groupMemberRows.map(r => r.id)).toContain(disb.id);

      // Unrelated group B sees nothing
      const groupBCtx: TenantContext = { userId: groupBOfficerId, groupId: groupBId, role: 'treasurer' };
      const groupBRows = await withDb(groupBCtx, (client) =>
        client.query<{ id: string }>('SELECT id FROM organization_disbursements').then(r => r.rows),
      );
      expect(groupBRows).toHaveLength(0);

      // The group-member axis grants SELECT but NOT write — proves the split
      // correctly kept SELECT broader than insert/update/delete. The insert
      // is otherwise fully valid (real wallet_id, unique reference) so RLS
      // is the only thing that can reject it — not an incidental NOT NULL.
      const [{ id: walletId }] = await rawQuery<{ id: string }>(
        `SELECT id FROM organization_wallets WHERE organization_id = $1`,
        [organizationId],
      );
      await expect(
        withDb(groupMemberCtx, (client) =>
          client.query(
            `INSERT INTO organization_disbursements (organization_id, wallet_id, group_id, amount, disbursement_type, status, reference)
             VALUES ($1, $2, $3, 1000, 'grant', 'pending_approval', $4)`,
            [organizationId, walletId, groupAId, `TEST-${disb.id}`],
          ),
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  describe('Group 3b: sms_usage_logs (group axis, previously FOR ALL, + org-payer axis, previously and still SELECT-only)', () => {
    it('both payer axes independently grant SELECT; an org coordinator cannot write (write stayed group-scoped only)', async () => {
      const { organizationId, coordinatorId } = await createTestOrganization();
      const { groupId, officerId } = await createTestGroup('treasurer');

      const [groupFunded] = await rawQuery<{ id: string }>(
        `INSERT INTO sms_usage_logs (group_id, recipient_phone, message_text, credits_deducted, payer_type)
         VALUES ($1, '254700000000', 'test', 1, 'group') RETURNING id`,
        [groupId],
      );
      const [orgFunded] = await rawQuery<{ id: string }>(
        `INSERT INTO sms_usage_logs (group_id, recipient_phone, message_text, credits_deducted, payer_type, payer_organization_id)
         VALUES ($1, '254700000000', 'test', 1, 'organization', $2) RETURNING id`,
        [groupId, organizationId],
      );

      const groupCtx: TenantContext = { userId: officerId, groupId, role: 'treasurer' };
      const groupRows = await withDb(groupCtx, (client) => client.query<{ id: string }>('SELECT id FROM sms_usage_logs').then(r => r.rows));
      expect(groupRows.map(r => r.id)).toEqual(expect.arrayContaining([groupFunded.id, orgFunded.id]));

      const coordinatorCtx: TenantContext = {
        userId: coordinatorId, groupId, role: 'organization_coordinator', organizationId,
      };
      const coordinatorRows = await withDb(coordinatorCtx, (client) => client.query<{ id: string }>('SELECT id FROM sms_usage_logs').then(r => r.rows));
      expect(coordinatorRows.map(r => r.id)).toContain(orgFunded.id);

      await expect(
        withDb(coordinatorCtx, (client) =>
          client.query(
            `INSERT INTO sms_usage_logs (group_id, recipient_phone, message_text, credits_deducted, payer_type, payer_organization_id)
             VALUES ($1, '254700000000', 'test', 1, 'organization', $2)`,
            [groupId, organizationId],
          ),
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });
});
