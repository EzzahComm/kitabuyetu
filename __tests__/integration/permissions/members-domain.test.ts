/**
 * RBAC permission activation, Batch 4 (SIMPLIFICATION_AND_RBAC_AUDIT.md
 * Workstream 4). Migrates the 5 route files that gated inline via
 * ROLES.canManageMembers()/canAdminGroup() — invisible to a withRole/
 * withOneOf call-site grep — onto requirePermission('members.manage') and
 * requirePermission('roles.manage') respectively, against real Postgres.
 */
import { PATCH as memberPatch, PUT as memberPut, DELETE as memberDelete } from '@/app/api/v1/members/[id]/route';
import { POST as statusPost } from '@/app/api/v1/members/[id]/status/route';
import { GET as kinGet, POST as kinPost } from '@/app/api/v1/members/[id]/next-of-kin/route';
import { authHeaders, buildRequest } from '../helpers/request';
import { createTestGroup, addGroupOfficer } from '../helpers/fixtures';
import { resetDatabase } from '../helpers/cleanup';
import { rawQuery } from '../helpers/db';

async function permissionsFor(role: string): Promise<string[]> {
  const [row] = await rawQuery<{ permissions: string[] }>(
    `SELECT permissions FROM public.roles WHERE group_id IS NULL AND code = $1`,
    [role],
  );
  return row.permissions;
}

describe('Members domain permission gates (formerly inline ROLES.can*())', () => {
  let groupId: string, memberAId: string, memberBId: string;
  let memberPerms: string[], secretaryPerms: string[], chairpersonPerms: string[];

  beforeAll(async () => {
    await resetDatabase();
    const { groupId: gId, officerId: founderId } = await createTestGroup('chairperson');
    groupId   = gId;
    memberAId = await addGroupOfficer(gId, founderId, 'member');
    memberBId = await addGroupOfficer(gId, founderId, 'member');
    memberPerms      = await permissionsFor('member');
    secretaryPerms   = await permissionsFor('secretary');
    chairpersonPerms = await permissionsFor('chairperson');
  });

  afterAll(async () => {
    await resetDatabase();
  });

  it('members.manage: a plain member CAN edit their own profile', async () => {
    const res = await memberPatch(
      buildRequest(`/api/v1/members/${memberAId}`, {
        method: 'PATCH', body: { firstName: 'SelfEdited' },
        headers: authHeaders({ userId: memberAId, groupId, role: 'member', permissions: memberPerms }),
      }),
      { params: Promise.resolve({ id: memberAId }) },
    );
    expect(res.status).toBe(200);
  });

  it('members.manage: a plain member CANNOT edit a different member\'s profile', async () => {
    const res = await memberPatch(
      buildRequest(`/api/v1/members/${memberBId}`, {
        method: 'PATCH', body: { firstName: 'Hijacked' },
        headers: authHeaders({ userId: memberAId, groupId, role: 'member', permissions: memberPerms }),
      }),
      { params: Promise.resolve({ id: memberBId }) },
    );
    expect(res.status).toBe(403);
  });

  it('members.manage: a secretary CAN edit a different member\'s profile', async () => {
    const res = await memberPatch(
      buildRequest(`/api/v1/members/${memberBId}`, {
        method: 'PATCH', body: { firstName: 'EditedBySecretary' },
        headers: authHeaders({ userId: memberAId, groupId, role: 'secretary', permissions: secretaryPerms }),
      }),
      { params: Promise.resolve({ id: memberBId }) },
    );
    expect(res.status).toBe(200);
  });

  it('roles.manage: a secretary CANNOT change a member\'s group role, a chairperson CAN', async () => {
    const denied = await memberPut(
      buildRequest(`/api/v1/members/${memberBId}`, {
        method: 'PUT', body: { role: 'treasurer' },
        headers: authHeaders({ userId: memberAId, groupId, role: 'secretary', permissions: secretaryPerms }),
      }),
      { params: Promise.resolve({ id: memberBId }) },
    );
    expect(denied.status).toBe(403);

    const allowed = await memberPut(
      buildRequest(`/api/v1/members/${memberBId}`, {
        method: 'PUT', body: { role: 'treasurer' },
        headers: authHeaders({ userId: memberAId, groupId, role: 'chairperson', permissions: chairpersonPerms }),
      }),
      { params: Promise.resolve({ id: memberBId }) },
    );
    expect(allowed.status).toBe(200);
  });

  it('members.manage: a plain member cannot deactivate another member or transition their status', async () => {
    const deleteRes = await memberDelete(
      buildRequest(`/api/v1/members/${memberBId}`, {
        method: 'DELETE',
        headers: authHeaders({ userId: memberAId, groupId, role: 'member', permissions: memberPerms }),
      }),
      { params: Promise.resolve({ id: memberBId }) },
    );
    expect(deleteRes.status).toBe(403);

    const statusRes = await statusPost(
      buildRequest(`/api/v1/members/${memberBId}/status`, {
        method: 'POST', body: { status: 'suspended', reason: 'test' },
        headers: authHeaders({ userId: memberAId, groupId, role: 'member', permissions: memberPerms }),
      }),
      { params: Promise.resolve({ id: memberBId }) },
    );
    expect(statusRes.status).toBe(403);
  });

  it('members.manage: next-of-kin routes deny a plain member, allow a secretary', async () => {
    const denied = await kinGet(
      buildRequest(`/api/v1/members/${memberBId}/next-of-kin`, {
        headers: authHeaders({ userId: memberAId, groupId, role: 'member', permissions: memberPerms }),
      }),
      { params: Promise.resolve({ id: memberBId }) },
    );
    expect(denied.status).toBe(403);

    const allowed = await kinPost(
      buildRequest(`/api/v1/members/${memberBId}/next-of-kin`, {
        method: 'POST',
        body: { fullName: 'Jane Doe', relationship: 'spouse', phone: '0712340099' },
        headers: authHeaders({ userId: memberAId, groupId, role: 'secretary', permissions: secretaryPerms }),
      }),
      { params: Promise.resolve({ id: memberBId }) },
    );
    expect(allowed.status).toBe(201);
  });
});
