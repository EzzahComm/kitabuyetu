/**
 * RBAC permission activation, Batch 7 (SIMPLIFICATION_AND_RBAC_AUDIT.md
 * Workstream 4) — the platform-role axis. /api/v1/organization/* was
 * previously gated 3 layers deep in organizationService.assertOrganizationCoordinator,
 * invisible from the route file; withOrganizationPermission makes it an
 * explicit, visible route-level gate. Not DB-backed (roles.base_role can't
 * represent organization_coordinator/super_admin at all), so this proves the
 * flat allowlist in lib/auth/organization-permissions.ts directly, plus that
 * the service-level assert still backstops it.
 */
import { GET as profileGet } from '@/app/api/v1/organization/profile/route';
import { GET as groupsGet } from '@/app/api/v1/organization/groups/route';
import { GET as walletGet } from '@/app/api/v1/organization/wallet/route';
import { authHeaders, buildRequest } from '../helpers/request';
import { createTestOrganization } from '../helpers/fixtures';
import { resetDatabase } from '../helpers/cleanup';

// These routes never read ctx.groupId — but it still flows into the real
// Postgres session GUC (setTenantLocals) and app_current_group_id() casts
// it to ::uuid whenever any RLS policy references it (e.g. groups_select,
// via listGroupSummaries' JOIN). A non-UUID placeholder like 'irrelevant'
// works fine under BYPASSRLS but throws under real RLS enforcement — caught
// by the app_tenant CI job. Use a syntactically valid (if non-existent) UUID.
const NO_GROUP = '00000000-0000-0000-0000-000000000000';

describe('Organization/* permission gates (platform-role axis)', () => {
  let organizationId: string, coordinatorId: string;

  beforeAll(async () => {
    await resetDatabase();
    ({ organizationId, coordinatorId } = await createTestOrganization());
  });

  afterAll(async () => {
    await resetDatabase();
  });

  it('a plain member-role caller (no group context relevant here) is denied on every organization route', async () => {
    const res = await profileGet(buildRequest('/api/v1/organization/profile', {
      headers: authHeaders({ userId: coordinatorId, groupId: NO_GROUP, role: 'member', organizationId }),
    }));
    expect(res.status).toBe(403);
  });

  it('a group-side treasurer (highest member_role rank below chairperson) is still denied — this is a different axis entirely', async () => {
    const res = await groupsGet(buildRequest('/api/v1/organization/groups', {
      headers: authHeaders({ userId: coordinatorId, groupId: NO_GROUP, role: 'treasurer', organizationId }),
    }));
    expect(res.status).toBe(403);
  });

  it('organization_coordinator with organizationId set CAN reach the profile route', async () => {
    const res = await profileGet(buildRequest('/api/v1/organization/profile', {
      headers: authHeaders({ userId: coordinatorId, groupId: NO_GROUP, role: 'organization_coordinator', organizationId }),
    }));
    expect(res.status).toBe(200);
  });

  it('organization_coordinator WITHOUT an organizationId claim is denied (context required)', async () => {
    const res = await profileGet(buildRequest('/api/v1/organization/profile', {
      headers: authHeaders({ userId: coordinatorId, groupId: NO_GROUP, role: 'organization_coordinator' }),
    }));
    expect(res.status).toBe(403);
  });

  it('super_admin bypasses the organization gate too (platform god-role, mirrors withPlatformRole precedent)', async () => {
    const res = await walletGet(buildRequest('/api/v1/organization/wallet', {
      headers: authHeaders({ userId: coordinatorId, groupId: NO_GROUP, role: 'super_admin', organizationId }),
    }));
    expect(res.status).toBe(200);
  });
});
