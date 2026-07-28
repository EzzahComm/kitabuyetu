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
  createOrgInvitation, getOrgInvitation, confirmOrgInvitationEmail,
  verifyOrgInvitationOtp, completeOrgInvitation,
} from '@/lib/services/organization-members.service';
import { createTestOrganization, createOrgCoordinator } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';

// The invite flow's two proof-of-possession channels are a real outbound
// email (lib/services/email.service.ts — EMAIL_DRY_RUN logs it but doesn't
// expose the rendered link back to the caller) and a real outbound SMS
// (lib/services/textsms.service.ts — no dry-run flag at all). Both are
// mocked here the same way any other genuinely external HTTP dependency
// would be; everything else (real Postgres, the actual service functions,
// the invited -> otp_sent -> verified -> completed state machine) runs for
// real. The mocks also let the test recover the plaintext token/OTP that
// only ever exist in the email link / SMS body, never on the DB row itself
// (token_hash/otp_hash are one-way hashes by design).
jest.mock('@/lib/services/email.service', () => ({
  sendTemplatedEmail: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('@/lib/services/textsms.service', () => ({
  sendSingleSms: jest.fn().mockResolvedValue({ success: true }),
}));
import { sendTemplatedEmail } from '@/lib/services/email.service';
import { sendSingleSms } from '@/lib/services/textsms.service';

function extractTokenFromEmailMock(): string {
  const call = (sendTemplatedEmail as jest.Mock).mock.calls.at(-1);
  const inviteUrl = call?.[0]?.vars?.inviteUrl as string;
  const token = inviteUrl?.split('/accept-org-invite/')[1];
  if (!token) throw new Error('Could not find invite token in mocked email vars');
  return token;
}

function extractOtpFromSmsMock(): string {
  const call = (sendSingleSms as jest.Mock).mock.calls.at(-1);
  const message = call?.[0]?.message as string;
  const match = message.match(/code is (\d{6})/);
  if (!match) throw new Error('Could not find OTP in mocked SMS message');
  return match[1];
}

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

describe('organization staff invitations (Phase 2 — email + phone-OTP)', () => {
  afterEach(async () => {
    jest.clearAllMocks();
    await resetDatabase();
  });

  it('walks the full invited -> otp_sent -> verified -> completed state machine against real Postgres', async () => {
    const { organizationId, coordinatorId } = await createTestOrganization();

    const invitation = await createOrgInvitation(organizationId, {
      email: 'amara@example.com', phone: '0712350001',
      firstName: 'Amara', lastName: 'Njeri', orgRole: 'staff', invitedBy: coordinatorId,
    });
    expect(sendTemplatedEmail).toHaveBeenCalledTimes(1);
    const token = extractTokenFromEmailMock();

    const lookedUp = await getOrgInvitation(token);
    expect(lookedUp.status).toBe('invited');
    expect(lookedUp.organizationId).toBe(organizationId);

    await confirmOrgInvitationEmail(token);
    expect(sendSingleSms).toHaveBeenCalledTimes(1);
    expect((await getOrgInvitation(token)).status).toBe('otp_sent');
    const otp = extractOtpFromSmsMock();

    await verifyOrgInvitationOtp(token, otp);
    expect((await getOrgInvitation(token)).status).toBe('verified');

    await completeOrgInvitation(token, 'S3curePass1');

    const [row] = await rawQuery<{ status: string; completed_at: Date | null }>(
      `SELECT status, completed_at FROM organization_invitations WHERE id = $1`, [invitation.id],
    );
    expect(row.status).toBe('completed');
    expect(row.completed_at).not.toBeNull();

    const staff = await listOrgStaff(organizationId);
    const newStaff = staff.find((s) => s.phone === '254712350001');
    expect(newStaff?.status).toBe('active');
    expect(newStaff?.orgRole).toBe('staff');
  });

  it('rejects an incorrect OTP and does not advance the invitation past otp_sent', async () => {
    const { organizationId, coordinatorId } = await createTestOrganization();
    await createOrgInvitation(organizationId, {
      email: 'b@example.com', phone: '0712350002',
      firstName: 'B', lastName: 'B', orgRole: 'staff', invitedBy: coordinatorId,
    });
    const token = extractTokenFromEmailMock();

    await confirmOrgInvitationEmail(token);
    await expect(verifyOrgInvitationOtp(token, '000000')).rejects.toThrow();
    expect((await getOrgInvitation(token)).status).toBe('otp_sent');
  });

  it('rejects completing an invitation before OTP verification', async () => {
    const { organizationId, coordinatorId } = await createTestOrganization();
    await createOrgInvitation(organizationId, {
      email: 'c@example.com', phone: '0712350003',
      firstName: 'C', lastName: 'C', orgRole: 'staff', invitedBy: coordinatorId,
    });
    const token = extractTokenFromEmailMock();

    await expect(completeOrgInvitation(token, 'S3curePass1')).rejects.toThrow();
  });
});
