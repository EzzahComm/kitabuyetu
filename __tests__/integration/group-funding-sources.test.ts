/**
 * group_funding_sources (migration 115) — the group-side funding attribution
 * anchor for the Capital & Investment Layer.
 *
 * The invariant under test is the one everything downstream depends on: EVERY
 * group has exactly one internal_savings funding source, from the moment it
 * exists. loan_funding_splits will default to it when a member loan is
 * disbursed without an explicit funding plan, which is what keeps existing loan
 * behaviour unchanged — so if this invariant can be violated, that guarantee
 * silently breaks instead of failing loudly.
 */
import { type TenantContext } from '@/lib/db';
import { listForGroup, getInternalSavingsSource } from '@/lib/services/funding-sources.service';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';

describe('group_funding_sources', () => {
  let groupAId: string, officerAId: string;
  let groupBId: string, officerBId: string;

  beforeAll(async () => {
    await resetDatabase();
    ({ groupId: groupAId, officerId: officerAId } = await createTestGroup('chairperson'));
    ({ groupId: groupBId, officerId: officerBId } = await createTestGroup('chairperson'));
  });

  afterAll(async () => {
    await resetDatabase();
  });

  const ctxA = (): TenantContext => ({ userId: officerAId, groupId: groupAId, role: 'chairperson' });
  const ctxB = (): TenantContext => ({ userId: officerBId, groupId: groupBId, role: 'chairperson' });

  describe('auto-provisioning trigger', () => {
    it('creates exactly one internal_savings source for a newly created group', async () => {
      const rows = await rawQuery<{ source_type: string; label: string; is_repayable: boolean }>(
        `SELECT source_type, label, is_repayable
         FROM group_funding_sources WHERE group_id = $1`,
        [groupAId],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].source_type).toBe('internal_savings');
      expect(rows[0].is_repayable).toBe(false);
    });

    it('provisions independently for every group', async () => {
      const rows = await rawQuery<{ n: string }>(
        `SELECT count(*) AS n FROM group_funding_sources
         WHERE group_id = ANY($1) AND source_type = 'internal_savings'`,
        [[groupAId, groupBId]],
      );
      expect(Number(rows[0].n)).toBe(2);
    });

    it('leaves no group without an internal_savings source (the migration-level invariant)', async () => {
      const rows = await rawQuery<{ n: string }>(
        `SELECT count(*) AS n FROM groups g
         WHERE NOT EXISTS (
           SELECT 1 FROM group_funding_sources s
           WHERE s.group_id = g.id AND s.source_type = 'internal_savings'
         )`,
      );
      expect(Number(rows[0].n)).toBe(0);
    });

    it('runs as SECURITY DEFINER, so it still writes under a non-BYPASSRLS role', async () => {
      // Regression guard for the exact bug class this codebase already shipped
      // once: private.update_account_balance() was a plain trigger writing to an
      // RLS-guarded table, so it silently matched zero rows (fixed in migration
      // 099). If someone recreates this function without SECURITY DEFINER, group
      // creation would stop provisioning sources the moment app_tenant goes live
      // — with no error anywhere.
      const rows = await rawQuery<{ prosecdef: boolean }>(
        `SELECT p.prosecdef
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'private' AND p.proname = 'provision_internal_funding_source'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].prosecdef).toBe(true);
    });
  });

  describe('constraints', () => {
    it('rejects a second internal_savings source for the same group', async () => {
      await expect(
        rawQuery(
          `INSERT INTO group_funding_sources (group_id, source_type, label)
           VALUES ($1, 'internal_savings', 'Duplicate savings')`,
          [groupAId],
        ),
      ).rejects.toThrow();
    });

    it('rejects an internal_savings source marked repayable', async () => {
      await expect(
        rawQuery(
          `INSERT INTO group_funding_sources (group_id, source_type, label, is_repayable)
           VALUES ($1, 'internal_savings', 'Repayable savings', true)`,
          [groupBId],
        ),
      ).rejects.toThrow();
    });

    it('rejects an organization_allocation source with no allocation or organization', async () => {
      await expect(
        rawQuery(
          `INSERT INTO group_funding_sources (group_id, source_type, label)
           VALUES ($1, 'organization_allocation', 'Dangling allocation')`,
          [groupAId],
        ),
      ).rejects.toThrow();
    });

    it('rejects a non-allocation source that names an allocation', async () => {
      await expect(
        rawQuery(
          `INSERT INTO group_funding_sources (group_id, source_type, label, allocation_id)
           VALUES ($1, 'external_grant', 'Grant with allocation', gen_random_uuid())`,
          [groupAId],
        ),
      ).rejects.toThrow();
    });

    it('rejects a closed source with no closed_at timestamp', async () => {
      await expect(
        rawQuery(
          `INSERT INTO group_funding_sources (group_id, source_type, label, status)
           VALUES ($1, 'other', 'Closed with no date', 'closed')`,
          [groupAId],
        ),
      ).rejects.toThrow();
    });

    it('accepts a valid additional non-allocation source', async () => {
      const rows = await rawQuery<{ id: string }>(
        `INSERT INTO group_funding_sources (group_id, source_type, label, is_repayable)
         VALUES ($1, 'external_grant', 'County womens fund', false)
         RETURNING id`,
        [groupAId],
      );
      expect(rows[0].id).toBeTruthy();
    });
  });

  describe('service layer', () => {
    it('getInternalSavingsSource returns the group\'s own savings source', async () => {
      const source = await getInternalSavingsSource(ctxA());

      expect(source.sourceType).toBe('internal_savings');
      expect(source.groupId).toBe(groupAId);
      expect(source.isRepayable).toBe(false);
      expect(source.status).toBe('active');
      expect(source.allocationId).toBeNull();
      expect(source.organizationId).toBeNull();
    });

    it('resolves a different source per group', async () => {
      const a = await getInternalSavingsSource(ctxA());
      const b = await getInternalSavingsSource(ctxB());

      expect(a.id).not.toBe(b.id);
      expect(a.groupId).toBe(groupAId);
      expect(b.groupId).toBe(groupBId);
    });

    it('listForGroup returns internal savings first', async () => {
      const sources = await listForGroup(ctxA());

      // Group A also has the external_grant added above.
      expect(sources.length).toBeGreaterThanOrEqual(2);
      expect(sources[0].sourceType).toBe('internal_savings');
    });

    it('listForGroup never leaks another group\'s sources', async () => {
      const sources = await listForGroup(ctxB());

      expect(sources.every((s) => s.groupId === groupBId)).toBe(true);
      expect(sources.some((s) => s.label === 'County womens fund')).toBe(false);
    });
  });

  describe('group deletion', () => {
    it('cascades funding sources when a group is deleted', async () => {
      const { groupId } = await createTestGroup('chairperson');

      const before = await rawQuery<{ n: string }>(
        `SELECT count(*) AS n FROM group_funding_sources WHERE group_id = $1`, [groupId],
      );
      expect(Number(before[0].n)).toBe(1);

      await rawQuery(`DELETE FROM groups WHERE id = $1`, [groupId]);

      const after = await rawQuery<{ n: string }>(
        `SELECT count(*) AS n FROM group_funding_sources WHERE group_id = $1`, [groupId],
      );
      expect(Number(after[0].n)).toBe(0);
    });
  });
});
