/**
 * Multi-staff organizations (migration 101). organization-disbursements-
 * tenant-isolation.test.ts already proves the maker-checker RLS/service
 * boundary works correctly given two coordinators for the same org — but it
 * simulates that via directly-forged auth headers (a test-harness privilege),
 * not through the actual mechanism that creates and links real staff. This
 * file proves the mechanism itself: lib/services/organization-members.service.ts
 * against a real Postgres instance.
 */
import {
  listOrgStaff, addOrgStaff, changeOrgStaffRole, removeOrgStaff,
} from '@/lib/services/organization-members.service';
import { createTestOrganization, createOrgCoordinator } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';

describe('organization staff (multi-staff organizations)', () => {
  afterEach(async () => {
    await resetDatabase();
  });

  it('adds a brand-new member as staff and lists them', async () => {
    const { organizationId, coordinatorId } = await createTestOrganization();

    const added = await addOrgStaff(organizationId, {
      phone: '0712340001', firstName: 'Amara', lastName: 'Njeri',
      orgRole: 'staff', invitedBy: coordinatorId,
    });
    expect(added.orgRole).toBe('staff');
    expect(added.status).toBe('active');

    const staff = await listOrgStaff(organizationId);
    expect(staff.map((s) => s.memberId)).toContain(added.memberId);

    const [row] = await rawQuery<{ platform_role: string }>(
      'SELECT platform_role FROM members WHERE id = $1', [added.memberId],
    );
    expect(row.platform_role).toBe('organization_coordinator');
  });

  it('links an existing member by phone without downgrading a different platform role they already hold', async () => {
    const { organizationId, coordinatorId } = await createTestOrganization();
    const existingSuperAdminId = await createOrgCoordinator(); // creates as organization_coordinator
    // Simulate this member already holding a MORE privileged role elsewhere.
    await rawQuery(`UPDATE members SET platform_role = 'super_admin' WHERE id = $1`, [existingSuperAdminId]);
    const [{ phone }] = await rawQuery<{ phone: string }>(
      'SELECT phone FROM members WHERE id = $1', [existingSuperAdminId],
    );

    await addOrgStaff(organizationId, {
      phone, firstName: 'x', lastName: 'x', orgRole: 'staff', invitedBy: coordinatorId,
    });

    const [row] = await rawQuery<{ platform_role: string }>(
      'SELECT platform_role FROM members WHERE id = $1', [existingSuperAdminId],
    );
    expect(row.platform_role).toBe('super_admin'); // NOT downgraded to organization_coordinator
  });

  it('rejects adding someone who is already active staff at the same org', async () => {
    const { organizationId, coordinatorId } = await createTestOrganization();
    await addOrgStaff(organizationId, {
      phone: '0712340002', firstName: 'B', lastName: 'B', orgRole: 'staff', invitedBy: coordinatorId,
    });

    await expect(addOrgStaff(organizationId, {
      phone: '0712340002', firstName: 'B', lastName: 'B', orgRole: 'staff', invitedBy: coordinatorId,
    })).rejects.toThrow();
  });

  it('changes a staff member\'s role', async () => {
    const { organizationId, coordinatorId } = await createTestOrganization();
    const added = await addOrgStaff(organizationId, {
      phone: '0712340003', firstName: 'C', lastName: 'C', orgRole: 'staff', invitedBy: coordinatorId,
    });

    await changeOrgStaffRole(organizationId, added.memberId, 'lead');

    const [staff] = (await listOrgStaff(organizationId)).filter((s) => s.memberId === added.memberId);
    expect(staff.orgRole).toBe('lead');
  });

  it('removing (archiving) staff proves the two-different-people maker-checker path is now reachable through real staff records, not just forged headers', async () => {
    const { organizationId, coordinatorId } = await createTestOrganization();
    // createTestOrganization()'s coordinator is a member with platform_role
    // = 'organization_coordinator', but createOrganization() never touches
    // organization_members (that table is new) — add them as lead explicitly
    // to get two real, distinct staff rows for the same org.
    const first = await addOrgStaff(organizationId, {
      phone: '0712340003', firstName: 'C', lastName: 'C', orgRole: 'lead', invitedBy: coordinatorId,
    });
    const second = await addOrgStaff(organizationId, {
      phone: '0712340004', firstName: 'D', lastName: 'D', orgRole: 'staff', invitedBy: first.memberId,
    });

    // Two distinct, real organization_members rows for the same org — this
    // is exactly the state that used to be structurally impossible to reach
    // (organizations.coordinator_member_id is a single FK). Both now show up
    // for real in organization_members, which is what the login-resolution
    // query (app/api/v1/auth/admin/login/verify/route.ts) reads from.
    const staff = await listOrgStaff(organizationId);
    expect(staff.filter((s) => s.status === 'active')).toHaveLength(2);

    await removeOrgStaff(organizationId, second.memberId, coordinatorId);
    const afterRemoval = await listOrgStaff(organizationId);
    expect(afterRemoval.find((s) => s.memberId === second.memberId)?.status).toBe('archived');
  });

  it('refuses to remove the last active lead', async () => {
    const { organizationId, coordinatorId } = await createTestOrganization();
    // createTestOrganization's coordinator isn't auto-added as organization_members
    // staff (that table is new) — add them as the org's lead explicitly first.
    await addOrgStaff(organizationId, {
      phone: '0712340005', firstName: 'Lead', lastName: 'One', orgRole: 'lead', invitedBy: coordinatorId,
    });
    const [lead] = await listOrgStaff(organizationId);

    await expect(removeOrgStaff(organizationId, lead.memberId, coordinatorId)).rejects.toThrow();
  });
});
