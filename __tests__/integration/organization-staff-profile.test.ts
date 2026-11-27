import { GET as getOrganization } from '@/app/api/admin/organizations/[id]/route';
import { PATCH } from '@/app/api/admin/organizations/[id]/staff/[memberId]/route';
import { backofficeHeaders, buildRequest } from './helpers/request';
import { createTestOrganization } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';

beforeAll(resetDatabase);
afterAll(resetDatabase);

it('edits an existing staff account in its organization with audit history and a retained phone', async () => {
  const { organizationId, coordinatorId } = await createTestOrganization();
  const { organizationId: otherOrg, coordinatorId: administratorId } = await createTestOrganization();
  const [before] = await rawQuery<{ phone: string }>('SELECT phone FROM members WHERE id=$1', [coordinatorId]);

  const edit = (id: string, platformRole: 'super_admin' | 'support', confirmEmail: boolean) =>
    PATCH(
      buildRequest(`/api/admin/organizations/${id}/staff/${coordinatorId}`, {
        method: 'PATCH',
        headers: backofficeHeaders({ userId: administratorId, platformRole }),
        body: {
          firstName: 'Revised',
          lastName: 'Coordinator',
          email: 'updated@example.test',
          ...(confirmEmail ? { emailOwnershipConfirmed: true } : {}),
        },
      }),
      { params: Promise.resolve({ id, memberId: coordinatorId }) },
    );

  expect((await edit(organizationId, 'support', true)).status).toBe(403);
  expect((await edit(otherOrg, 'super_admin', true)).status).toBe(404);
  expect((await edit(organizationId, 'super_admin', false)).status).toBe(400);
  expect((await edit(organizationId, 'super_admin', true)).status).toBe(200);
  const [after] = await rawQuery('SELECT first_name,last_name,email,email_verified,phone FROM members WHERE id=$1', [
    coordinatorId,
  ]);
  expect(after).toEqual({
    first_name: 'Revised',
    last_name: 'Coordinator',
    email: 'updated@example.test',
    email_verified: true,
    phone: before.phone,
  });
  expect(
    await rawQuery(
      "SELECT 1 FROM audit_logs WHERE organization_id=$1 AND resource_id=$2 AND action='member.profile_update'",
      [organizationId, coordinatorId],
    ),
  ).toHaveLength(1);
});

it('reports the staff edit permission from the authenticated organization request', async () => {
  const { organizationId, coordinatorId } = await createTestOrganization();
  for (const platformRole of ['super_admin', 'support'] as const) {
    const response = await getOrganization(
      buildRequest(`/api/admin/organizations/${organizationId}`, {
        headers: backofficeHeaders({ userId: coordinatorId, platformRole }),
      }),
      { params: Promise.resolve({ id: organizationId }) },
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data.canEditStaff).toBe(platformRole === 'super_admin');
  }
});
