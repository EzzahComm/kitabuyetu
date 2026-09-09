/**
 * ADR-001 Phase 1 proof (docs/adr/001-bypassrls-two-role-split.md): with
 * `app_tenant` provisioned (NOSUPERUSER NOBYPASSRLS) and TENANT_DATABASE_URL
 * pointed at it, Postgres's own RLS policy — not any service-layer
 * `WHERE group_id = ...` clause — is what filters cross-tenant rows.
 *
 * Runs only under jest.integration.app-tenant.config.ts
 * (`npm run test:integration:app-tenant`), never under the default
 * `test:integration` run: against the plain BYPASSRLS admin pool this would
 * trivially "pass" for the wrong reason. The first test below guards against
 * exactly that misconfiguration by asserting the connection's own role
 * identity before trusting anything else it proves.
 */
import { withDb, type TenantContext } from '@/lib/db';
import { createTestGroup } from '../helpers/fixtures';
import { resetDatabase } from '../helpers/cleanup';
import { rawQuery } from '../helpers/db';

describe('app_tenant RLS enforcement (real Postgres, no service-layer WHERE clause)', () => {
  let groupAId: string, officerAId: string;
  let groupBId: string, officerBId: string;
  let meetingAId: string;

  beforeAll(async () => {
    await resetDatabase();
    ({ groupId: groupAId, officerId: officerAId } = await createTestGroup('chairperson'));
    ({ groupId: groupBId, officerId: officerBId } = await createTestGroup('chairperson'));

    const [meetingA] = await rawQuery<{ id: string }>(
      `INSERT INTO meetings (group_id, title, scheduled_at, created_by)
       VALUES ($1, 'Group A meeting', now(), $2) RETURNING id`,
      [groupAId, officerAId],
    );
    meetingAId = meetingA.id;

    await rawQuery(
      `INSERT INTO meetings (group_id, title, scheduled_at, created_by)
       VALUES ($1, 'Group B meeting', now(), $2)`,
      [groupBId, officerBId],
    );
  });

  afterAll(async () => {
    await resetDatabase();
  });

  it('is actually connected as app_tenant (no BYPASSRLS, no superuser) — not the admin pool', async () => {
    const ctx: TenantContext = { userId: officerAId, groupId: groupAId, role: 'chairperson' };
    const [role] = await withDb(ctx, async (client) => {
      const { rows } = await client.query<{
        rolname: string; rolbypassrls: boolean; rolsuper: boolean;
      }>('SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user');
      return rows;
    });

    expect(role.rolname).toBe('app_tenant');
    expect(role.rolbypassrls).toBe(false);
    expect(role.rolsuper).toBe(false);
  });

  it("returns only group A's meeting for a raw SELECT with NO WHERE clause, under group A's tenant context", async () => {
    const ctx: TenantContext = { userId: officerAId, groupId: groupAId, role: 'chairperson' };

    const rows = await withDb(ctx, async (client) => {
      const { rows } = await client.query<{ id: string; group_id: string }>(
        'SELECT id, group_id FROM meetings',
      );
      return rows;
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(meetingAId);
    expect(rows[0].group_id).toBe(groupAId);
  });

  it("returns only group B's meeting for the same unfiltered query, under group B's tenant context", async () => {
    const ctx: TenantContext = { userId: officerBId, groupId: groupBId, role: 'chairperson' };

    const rows = await withDb(ctx, async (client) => {
      const { rows } = await client.query<{ id: string; group_id: string }>(
        'SELECT id, group_id FROM meetings',
      );
      return rows;
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].group_id).toBe(groupBId);
  });
});
