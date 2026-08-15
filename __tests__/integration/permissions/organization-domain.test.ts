/**
 * RBAC permission activation, Batch 7 (SIMPLIFICATION_AND_RBAC_AUDIT.md
 * Workstream 4) — the platform-role axis, now on the BACKOFFICE audience.
 *
 * The organization tree moved from /api/v1/organization/* to
 * /api/admin/organization/* behind `withOrganizationAccess`. The old guard was
 * built on withAuth/getAuthContext, which demands a TENANT token with a real
 * groupId — something an organization coordinator never holds, since they sign
 * in through the enterprise portal and get a backoffice token carrying an
 * organization and no group. Every organization route answered "Missing
 * authentication context" as a result.
 *
 * This file proves the flat allowlist in lib/auth/organization-permissions.ts
 * still gates the tree identically under the new context, and — the part that
 * was missing before — that a caller with NO group can actually get through.
 */
import { GET as profileGet } from '@/app/api/admin/organization/profile/route';
import { GET as groupsGet } from '@/app/api/admin/organization/groups/route';
import { GET as walletGet } from '@/app/api/admin/organization/wallet/route';
import { backofficeHeaders, buildRequest } from '../helpers/request';
import { createTestOrganization } from '../helpers/fixtures';
import { resetDatabase } from '../helpers/cleanup';

describe('Organization/* permission gates (platform-role axis, backoffice audience)', () => {
  let organizationId: string, coordinatorId: string;

  beforeAll(async () => {
    await resetDatabase();
    ({ organizationId, coordinatorId } = await createTestOrganization());
  });

  afterAll(async () => {
    await resetDatabase();
  });

  it('a support-role caller is denied on every organization route', async () => {
    const res = await profileGet(buildRequest('/api/admin/organization/profile', {
      headers: backofficeHeaders({ userId: coordinatorId, platformRole: 'support', organizationId }),
    }));
    expect(res.status).toBe(403);
  });

  it('organization_coordinator with organizationId set CAN reach the profile route — with NO group context at all', async () => {
    // The whole point: this caller has no groupId, and that is now fine.
    // Previously it threw UnauthorizedError('Missing authentication context').
    const res = await profileGet(buildRequest('/api/admin/organization/profile', {
      headers: backofficeHeaders({ userId: coordinatorId, platformRole: 'organization_coordinator', organizationId }),
    }));
    expect(res.status).toBe(200);
  });

  it('organization_coordinator WITHOUT an organizationId claim is denied (context required)', async () => {
    const res = await profileGet(buildRequest('/api/admin/organization/profile', {
      headers: backofficeHeaders({ userId: coordinatorId, platformRole: 'organization_coordinator' }),
    }));
    expect(res.status).toBe(403);
  });

  it('super_admin bypasses the organization gate too (platform god-role, mirrors withPlatformRole precedent)', async () => {
    const res = await walletGet(buildRequest('/api/admin/organization/wallet', {
      headers: backofficeHeaders({ userId: coordinatorId, platformRole: 'super_admin', organizationId }),
    }));
    expect(res.status).toBe(200);
  });

  it('a TENANT token is rejected outright — this tree is not group-scoped', async () => {
    const res = await groupsGet(buildRequest('/api/admin/organization/groups', {
      headers: {
        'x-aud': 'tenant',
        'x-user-id': coordinatorId,
        'x-group-id': '00000000-0000-0000-0000-000000000000',
        'x-role': 'organization_coordinator',
        'x-organization-id': organizationId,
      },
    }));
    expect(res.status).toBe(403);
  });

  it('group-scoped reads still work for an org caller with no group — org scoping is organizationId, not groupId', async () => {
    // listGroupSummaries JOINs group-scoped tables. With no group in the
    // session, app_current_group_id() resolves to NULL rather than erroring
    // (NULLIF(current_setting(...), '')::uuid), and organization scoping does
    // the real filtering. Guards the '' sentinel withOrganizationAccess passes.
    const res = await groupsGet(buildRequest('/api/admin/organization/groups', {
      headers: backofficeHeaders({ userId: coordinatorId, platformRole: 'organization_coordinator', organizationId }),
    }));
    expect(res.status).toBe(200);
  });
});
