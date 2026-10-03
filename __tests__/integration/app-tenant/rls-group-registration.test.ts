/**
 * Group registration + contribution plan under the real `app_tenant` role, so
 * Postgres's own RLS decides - not a service-layer WHERE clause.
 *
 * What this pins, because production's policies say so (migration-era
 * `groups_update` / `policies_insert`):
 *   - Only a group's CHAIRPERSON can update the group record. The registration
 *     routes are chairperson-only for exactly that reason, and the service must
 *     REFUSE for anyone else rather than report a success the database filtered out.
 *   - The contribution plan lives in `policies`, which is group-scoped, not
 *     role-scoped: any officer may set it (the route adds its own
 *     treasury.manage check), and another group can never see it.
 *
 * Runs only under jest.integration.app-tenant.config.ts. The first test guards
 * against the misconfiguration that would make everything below pass for the
 * wrong reason (running as the BYPASSRLS admin pool).
 */
import { withDb, type TenantContext } from '@/lib/db';
import { contributionPlanService } from '@/lib/services/contribution-plan.service';
import { groupRegistrationService } from '@/lib/services/group-registration.service';
import { addGroupOfficer, createTestGroup } from '../helpers/fixtures';
import { resetDatabase } from '../helpers/cleanup';
import { rawQuery } from '../helpers/db';

describe('group registration + contribution plan (real Postgres, app_tenant RLS)', () => {
  let groupId: string;
  let chairpersonId: string;
  let treasurerId: string;
  let otherGroupId: string;
  let otherChairpersonId: string;

  const chair = (): TenantContext => ({ userId: chairpersonId, groupId, role: 'chairperson' });
  const treasurer = (): TenantContext => ({ userId: treasurerId, groupId, role: 'treasurer' });

  beforeAll(async () => {
    await resetDatabase();
    ({ groupId, officerId: chairpersonId } = await createTestGroup('chairperson'));
    treasurerId = await addGroupOfficer(groupId, chairpersonId, 'treasurer');
    ({ groupId: otherGroupId, officerId: otherChairpersonId } = await createTestGroup('chairperson'));
  });

  afterAll(async () => {
    await resetDatabase();
  });

  it('is actually connected as app_tenant (no BYPASSRLS, no superuser) - not the admin pool', async () => {
    const [role] = await withDb(chair(), async (client) => {
      const { rows } = await client.query<{ rolname: string; rolbypassrls: boolean; rolsuper: boolean }>(
        'SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user',
      );
      return rows;
    });

    expect(role.rolname).toBe('app_tenant');
    expect(role.rolbypassrls).toBe(false);
    expect(role.rolsuper).toBe(false);
  });

  it('lets the chairperson mark the group registered, and reads it back', async () => {
    const saved = await groupRegistrationService.setStatus(chair(), {
      isGovernmentRegistered: true,
      registrationNumber: '  CBO/777/2026 ',
    });

    expect(saved).toMatchObject({
      isGovernmentRegistered: true,
      registrationNumber: 'CBO/777/2026',
      certificateUrl: null,
    });
    expect(await groupRegistrationService.get(treasurer())).toMatchObject({
      isGovernmentRegistered: true,
      registrationNumber: 'CBO/777/2026',
    });
  });

  it('refuses a treasurer - the groups_update policy filters the UPDATE out - and changes nothing', async () => {
    await expect(
      groupRegistrationService.setStatus(treasurer(), { isGovernmentRegistered: false, registrationNumber: null }),
    ).rejects.toThrow('Group not found');

    const [row] = await rawQuery<{ is_government_registered: boolean; registration_number: string | null }>(
      `SELECT is_government_registered, registration_number FROM groups WHERE id = $1`,
      [groupId],
    );
    expect(row).toEqual({ is_government_registered: true, registration_number: 'CBO/777/2026' });
  });

  it('lets any officer set the contribution plan, and keeps it private to the group', async () => {
    await contributionPlanService.setGroupPlanOverride(treasurer(), { monthlyContribution: 750, welfareAmount: 150 });

    expect(await contributionPlanService.getGroupPlan(treasurer())).toEqual({
      plan: { monthlyContribution: 750, welfareAmount: 150 },
      source: 'group',
    });

    // Another group sees only the platform default (nothing configured), never this plan.
    const otherCtx: TenantContext = { userId: otherChairpersonId, groupId: otherGroupId, role: 'chairperson' };
    expect(await contributionPlanService.getGroupPlan(otherCtx)).toEqual({
      plan: { monthlyContribution: 0, welfareAmount: 0 },
      source: 'platform',
    });
  });
});
