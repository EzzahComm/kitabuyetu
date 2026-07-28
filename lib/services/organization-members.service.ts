/**
 * Multi-staff organizations (Phase 1 of the plan — see
 * docs/adr or the session's plan file for full context). organization_members
 * (migration 101) supersedes organizations.coordinator_member_id (kept,
 * legacy/display-only) as the source of truth for who can act on behalf of
 * an organization.
 *
 * Every function here is called from the super_admin backoffice UI
 * (app/(admin)/admin/organizations/[id]/page.tsx), so — mirroring
 * admin-organizations.service.ts's own established convention exactly —
 * these use withAdminDb (not a tenant ctx + RLS), take an explicit
 * organizationId, and are gated at the route layer (super_admin only), not
 * here. This is deliberately NOT the same shape as members.service.ts
 * (group-scoped, ctx-based, RLS-enforced): organization staff aren't
 * joining a group, so membersService.create()'s linkMemberToGroup() step
 * doesn't apply — only the "find or create a member by phone" part is
 * genuinely shared, reused here via members.service.ts's now-exported
 * generateTempPassword()/BCRYPT_ROUNDS rather than duplicated.
 *
 * The RLS policies on organization_members (org_role = 'lead' required for
 * INSERT/UPDATE) exist for defense-in-depth and for a future self-service
 * path (an org's own lead managing their own staff via the tenant-scoped
 * (enterprise) portal) — not exercised by this admin-only Phase 1 UI, which
 * bypasses them entirely via withAdminDb like every other admin-organizations
 * function already does.
 */
import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import { withAdminDb } from '@/lib/db';
import { normalizePhone } from '@/lib/utils/phone';
import { NotFoundError, ConflictError, ValidationError } from '@/lib/utils/errors';
import { BCRYPT_ROUNDS, generateTempPassword } from './members.service';
import { updatePlatformUserRole } from './admin.service';
import { hashSecret, generateEmailToken, generateOtp } from './group-verification.service';
import { sendTemplatedEmail } from './email.service';
import { sendSingleSms } from './textsms.service';

/**
 * Finds an existing member by phone, or creates one with a temp/given
 * password. Shared by addOrgStaff() (Phase 1, direct-add) and
 * completeOrgInvitation() (Phase 2, email/OTP invite) — the only genuinely
 * common step between them; nothing else about the two flows overlaps.
 * Never downgrades an existing, different platform_role (e.g.
 * super_admin/support) — only promotes someone who's currently a plain
 * 'member'.
 */
async function findOrCreateMemberForOrgStaff(
  db: PoolClient,
  input: { phone: string; firstName: string; lastName: string; email?: string | null; passwordHash?: string },
): Promise<string> {
  const phone = normalizePhone(input.phone);
  const existing = await db.query<{ id: string; platform_role: string }>(
    `SELECT id, platform_role FROM public.members WHERE phone = $1`,
    [phone],
  );

  if (existing.rows[0]) {
    if (existing.rows[0].platform_role === 'member') {
      await updatePlatformUserRole(existing.rows[0].id, 'organization_coordinator');
    }
    return existing.rows[0].id;
  }

  const passwordHash = input.passwordHash ?? await bcrypt.hash(generateTempPassword(), BCRYPT_ROUNDS);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO public.members (phone, email, password_hash, first_name, last_name, platform_role)
     VALUES ($1, $2, $3, $4, $5, 'organization_coordinator')
     RETURNING id`,
    [phone, input.email ?? null, passwordHash, input.firstName, input.lastName],
  );
  return rows[0].id;
}

export type OrgRole = 'lead' | 'staff';

export interface OrgStaffRow {
  id:         string;
  memberId:   string;
  firstName:  string;
  lastName:   string;
  phone:      string;
  email:      string | null;
  orgRole:    OrgRole;
  status:     'active' | 'archived';
  joinedAt:   Date;
}

interface StaffQueryRow {
  id: string; member_id: string; first_name: string; last_name: string;
  phone: string; email: string | null; org_role: OrgRole; status: 'active' | 'archived';
  joined_at: Date;
}

function mapRow(r: StaffQueryRow): OrgStaffRow {
  return {
    id: r.id, memberId: r.member_id, firstName: r.first_name, lastName: r.last_name,
    phone: r.phone, email: r.email, orgRole: r.org_role, status: r.status, joinedAt: r.joined_at,
  };
}

export async function listOrgStaff(organizationId: string): Promise<OrgStaffRow[]> {
  return withAdminDb(async (db: PoolClient) => {
    const { rows } = await db.query<StaffQueryRow>(
      `SELECT om.id, om.member_id, m.first_name, m.last_name, m.phone, m.email,
              om.org_role, om.status, om.joined_at
       FROM public.organization_members om
       JOIN public.members m ON m.id = om.member_id
       WHERE om.organization_id = $1
       ORDER BY (om.org_role = 'lead') DESC, om.status, m.first_name`,
      [organizationId],
    );
    return rows.map(mapRow);
  });
}

export interface AddOrgStaffInput {
  phone:     string;
  firstName: string;
  lastName:  string;
  orgRole:   OrgRole;
  invitedBy: string; // super_admin's own member id
}

/**
 * Finds or creates a member by phone (mirrors membersService.create()'s
 * find-or-create step, minus the group-linking that doesn't apply here),
 * ensures they hold platform_role = 'organization_coordinator' (only if
 * they don't already hold a DIFFERENT platform role — never silently
 * downgrades an existing super_admin/support assignment), and links them
 * into the organization.
 */
export async function addOrgStaff(
  organizationId: string,
  input: AddOrgStaffInput,
): Promise<OrgStaffRow> {
  const phone = normalizePhone(input.phone);

  return withAdminDb(async (db: PoolClient) => {
    const org = await db.query<{ id: string }>(
      `SELECT id FROM public.organizations WHERE id = $1`,
      [organizationId],
    );
    if (!org.rows[0]) throw new NotFoundError('Organization', organizationId);

    const memberId = await findOrCreateMemberForOrgStaff(db, input);

    const alreadyMember = await db.query(
      `SELECT 1 FROM public.organization_members WHERE organization_id = $1 AND member_id = $2 AND status = 'active'`,
      [organizationId, memberId],
    );
    if (alreadyMember.rows[0]) throw new ConflictError('This person is already active staff for this organization');

    const { rows: omRows } = await db.query<{ id: string; joined_at: Date }>(
      `INSERT INTO public.organization_members (organization_id, member_id, org_role, invited_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id, member_id)
         DO UPDATE SET status = 'active', org_role = EXCLUDED.org_role, archived_at = NULL, archived_by = NULL
       RETURNING id, joined_at`,
      [organizationId, memberId, input.orgRole, input.invitedBy],
    );

    return {
      id: omRows[0].id, memberId, firstName: input.firstName, lastName: input.lastName,
      phone, email: null, orgRole: input.orgRole, status: 'active', joinedAt: omRows[0].joined_at,
    };
  });
}

export async function changeOrgStaffRole(
  organizationId: string, memberId: string, orgRole: OrgRole,
): Promise<void> {
  return withAdminDb(async (db: PoolClient) => {
    const { rowCount } = await db.query(
      `UPDATE public.organization_members SET org_role = $1
       WHERE organization_id = $2 AND member_id = $3 AND status = 'active'`,
      [orgRole, organizationId, memberId],
    );
    if (!rowCount) throw new NotFoundError('Active organization staff member', memberId);
  });
}

export async function removeOrgStaff(
  organizationId: string, memberId: string, removedBy: string,
): Promise<void> {
  return withAdminDb(async (db: PoolClient) => {
    const remaining = await db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM public.organization_members
       WHERE organization_id = $1 AND status = 'active' AND org_role = 'lead' AND member_id != $2`,
      [organizationId, memberId],
    );
    const target = await db.query<{ org_role: OrgRole }>(
      `SELECT org_role FROM public.organization_members
       WHERE organization_id = $1 AND member_id = $2 AND status = 'active'`,
      [organizationId, memberId],
    );
    if (!target.rows[0]) throw new NotFoundError('Active organization staff member', memberId);
    if (target.rows[0].org_role === 'lead' && parseInt(remaining.rows[0].count, 10) === 0) {
      throw new ValidationError('Cannot remove the last lead — assign another lead first');
    }

    const { rowCount } = await db.query(
      `UPDATE public.organization_members
       SET status = 'archived', archived_at = NOW(), archived_by = $3
       WHERE organization_id = $1 AND member_id = $2 AND status = 'active'`,
      [organizationId, memberId, removedBy],
    );
    if (!rowCount) throw new NotFoundError('Active organization staff member', memberId);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — real email + phone-OTP invite (migration 102), alongside the
// Phase 1 direct-add path above (addOrgStaff() is unchanged and still used
// for adding someone who's already a known member). Two-channel
// verification (emailed link, then SMS OTP sent only after the link is
// clicked) before a real backoffice-privileged account is created — reuses
// group-verification.service.ts's crypto primitives and plain-service-
// function style rather than the DB-RPC style that flow itself happens to
// use (that's specific to its own dual email/SMS-channel design, not a
// pattern this simpler single-flow feature needs to copy).
// ─────────────────────────────────────────────────────────────────────────────

const OTP_TTL_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 5;

export interface OrgInvitationRow {
  id:               string;
  organizationId:   string;
  organizationName: string;
  email:            string;
  firstName:        string;
  lastName:         string;
  orgRole:          OrgRole;
  status:           string;
}

function acceptInviteUrlFor(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://kitabuyetu.vercel.app').replace(/\/$/, '');
  return `${base}/accept-org-invite/${token}`;
}

async function loadInvitationByTokenHash(
  db: PoolClient, tokenHash: string,
): Promise<{
  id: string; organization_id: string; organization_name: string; email: string; phone: string;
  first_name: string; last_name: string; org_role: OrgRole; status: string; invited_by: string;
  otp_hash: string | null; otp_expires_at: Date | null; otp_attempts: number; expires_at: Date;
} | null> {
  const { rows } = await db.query(
    `SELECT oi.id, oi.organization_id, o.name AS organization_name, oi.email, oi.phone,
            oi.first_name, oi.last_name, oi.org_role, oi.status, oi.invited_by,
            oi.otp_hash, oi.otp_expires_at, oi.otp_attempts, oi.expires_at
       FROM public.organization_invitations oi
       JOIN public.organizations o ON o.id = oi.organization_id
      WHERE oi.token_hash = $1`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

/** Lead/super_admin-only. Creates the invitation and sends the confirmation email. */
export async function createOrgInvitation(
  organizationId: string,
  input: { email: string; phone: string; firstName: string; lastName: string; orgRole: OrgRole; invitedBy: string },
): Promise<{ id: string; expiresAt: Date }> {
  const phone = normalizePhone(input.phone);
  const token = generateEmailToken();
  const tokenHash = hashSecret(token);

  const result = await withAdminDb(async (db: PoolClient) => {
    const org = await db.query<{ id: string; name: string }>(
      `SELECT id, name FROM public.organizations WHERE id = $1`,
      [organizationId],
    );
    if (!org.rows[0]) throw new NotFoundError('Organization', organizationId);

    const { rows } = await db.query<{ id: string; expires_at: Date }>(
      `INSERT INTO public.organization_invitations
         (organization_id, email, phone, first_name, last_name, org_role, invited_by, token_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, expires_at`,
      [organizationId, input.email, phone, input.firstName, input.lastName, input.orgRole, input.invitedBy, tokenHash],
    );
    return { id: rows[0].id, expiresAt: rows[0].expires_at, organizationName: org.rows[0].name };
  });

  await sendTemplatedEmail({
    templateKey: 'org_staff_invite',
    to:          input.email,
    vars: {
      firstName:        input.firstName,
      organizationName: result.organizationName,
      inviteUrl:         acceptInviteUrlFor(token),
    },
  });

  return { id: result.id, expiresAt: result.expiresAt };
}

/** Public. Safe to call from a GET — read-only, no state transition. */
export async function getOrgInvitation(token: string): Promise<OrgInvitationRow> {
  const tokenHash = hashSecret(token);
  return withAdminDb(async (db: PoolClient) => {
    const inv = await loadInvitationByTokenHash(db, tokenHash);
    if (!inv || inv.status === 'cancelled') throw new NotFoundError('Invitation', token);
    if (inv.status !== 'completed' && inv.expires_at < new Date()) {
      throw new ValidationError('This invitation has expired');
    }
    return {
      id: inv.id, organizationId: inv.organization_id, organizationName: inv.organization_name,
      email: inv.email, firstName: inv.first_name, lastName: inv.last_name,
      orgRole: inv.org_role, status: inv.status,
    };
  });
}

/** Public. Marks the email link as used and sends the SMS OTP — the second, distinct channel. */
export async function confirmOrgInvitationEmail(token: string): Promise<{ phone: string }> {
  const tokenHash = hashSecret(token);
  const otp = generateOtp();
  const otpHash = hashSecret(otp);

  const phone = await withAdminDb(async (db: PoolClient) => {
    const inv = await loadInvitationByTokenHash(db, tokenHash);
    if (!inv) throw new NotFoundError('Invitation', token);
    if (inv.expires_at < new Date()) throw new ValidationError('This invitation has expired');
    if (!['invited', 'email_confirmed', 'otp_sent'].includes(inv.status)) {
      throw new ValidationError('This invitation has already been used');
    }

    await db.query(
      `UPDATE public.organization_invitations
       SET status = 'otp_sent', otp_hash = $2, otp_expires_at = NOW() + make_interval(mins => $3), otp_attempts = 0
       WHERE id = $1`,
      [inv.id, otpHash, OTP_TTL_MINUTES],
    );
    return inv.phone;
  });

  await sendSingleSms({
    mobile:  phone,
    message: `Your Kitabu Yetu staff invite code is ${otp}. It expires in ${OTP_TTL_MINUTES} minutes.`,
  });

  return { phone };
}

/** Public. */
export async function verifyOrgInvitationOtp(token: string, otp: string): Promise<void> {
  const tokenHash = hashSecret(token);
  const otpHash = hashSecret(otp.trim());

  return withAdminDb(async (db: PoolClient) => {
    const inv = await loadInvitationByTokenHash(db, tokenHash);
    if (!inv) throw new NotFoundError('Invitation', token);
    if (inv.status !== 'otp_sent') throw new ValidationError('Request a code before verifying it');
    if (!inv.otp_hash || !inv.otp_expires_at || inv.otp_expires_at < new Date()) {
      throw new ValidationError('This code has expired — request a new one');
    }
    if (inv.otp_attempts >= MAX_OTP_ATTEMPTS) {
      throw new ValidationError('Too many attempts — request a new code');
    }
    if (inv.otp_hash !== otpHash) {
      await db.query(
        `UPDATE public.organization_invitations SET otp_attempts = otp_attempts + 1 WHERE id = $1`,
        [inv.id],
      );
      throw new ValidationError('Incorrect code');
    }

    await db.query(`UPDATE public.organization_invitations SET status = 'verified' WHERE id = $1`, [inv.id]);
  });
}

/** Public. Creates/links the member and marks the invitation completed. */
export async function completeOrgInvitation(token: string, password: string): Promise<void> {
  const tokenHash = hashSecret(token);

  return withAdminDb(async (db: PoolClient) => {
    const inv = await loadInvitationByTokenHash(db, tokenHash);
    if (!inv) throw new NotFoundError('Invitation', token);
    if (inv.status !== 'verified') throw new ValidationError('Verify your code before setting a password');

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const memberId = await findOrCreateMemberForOrgStaff(db, {
      phone: inv.phone, firstName: inv.first_name, lastName: inv.last_name, email: inv.email, passwordHash,
    });

    await db.query(
      `INSERT INTO public.organization_members (organization_id, member_id, org_role, invited_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id, member_id)
         DO UPDATE SET status = 'active', org_role = EXCLUDED.org_role, archived_at = NULL, archived_by = NULL`,
      [inv.organization_id, memberId, inv.org_role, inv.invited_by],
    );

    await db.query(
      `UPDATE public.organization_invitations SET status = 'completed', completed_at = NOW() WHERE id = $1`,
      [inv.id],
    );
  });
}
