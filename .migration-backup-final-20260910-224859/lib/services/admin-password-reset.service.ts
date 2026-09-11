/**
 * Self-service forgot-password for backoffice staff (super_admin / support /
 * organization_coordinator) — closes the gap flagged in
 * docs/audits/ORGANIZATION_LOGIN_ARCHITECTURE_AUDIT.md §4/§10 Phase 1:
 * password-reset.service.ts's SMS-OTP flow only ever looked up `members` by
 * `phone`, so a staff account (email/password, per AdminLoginSchema's own
 * comment — "staff identities are issued + recovered via email, never
 * phone") had no self-service recovery path at all.
 *
 * Reuses `members.reset_otp_hash/reset_otp_expires_at/reset_otp_attempts`
 * (migration 104) rather than adding new columns — those columns are
 * generic "one in-flight reset attempt per member" storage, not
 * phone-specific, and staff rows live in the same `members` table (see
 * app/api/v1/auth/admin/login/route.ts). The secret itself is an emailed
 * link token (generateEmailToken, the same 32-byte-random/SHA-256 shape
 * already proven by group-verification.service.ts and the org-invite flow)
 * rather than a typed OTP, since email is a link-click channel, not a
 * type-a-code channel.
 *
 * Enumeration-safe: startAdminPasswordReset() never reveals whether an
 * email belongs to a staff account, and resetAdminPasswordWithToken() uses
 * one generic error message whether the token doesn't exist, is expired,
 * or belongs to an account that's no longer active/staff.
 */
import bcrypt from 'bcryptjs';
import { withAdminDb } from '@/lib/db';
import { ValidationError } from '@/lib/utils/errors';
import { hashSecret, generateEmailToken } from './group-verification.service';
import { sendPasswordResetEmail } from './member-email.service';
import { BCRYPT_ROUNDS } from './members.service';

const RESET_TTL_MINUTES = 30;
const GENERIC_ERROR = 'Invalid or expired reset link';

const PLATFORM_ROLES = ['super_admin', 'support', 'organization_coordinator'];

function buildResetUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://kitabuyetu.vercel.app').replace(/\/$/, '');
  return `${base}/admin-login/reset-password?token=${token}`;
}

/** Always resolves without error, whether or not the email belongs to a staff account. */
export async function startAdminPasswordReset(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  const token = generateEmailToken();
  const tokenHash = hashSecret(token);

  const staff = await withAdminDb(async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM public.members
        WHERE lower(email) = $1 AND is_active = true AND platform_role = ANY($2)`,
      [normalized, PLATFORM_ROLES],
    );
    if (!rows[0]) return null;

    await db.query(
      `UPDATE public.members
       SET reset_otp_hash = $2, reset_otp_expires_at = NOW() + make_interval(mins => $3), reset_otp_attempts = 0
       WHERE id = $1`,
      [rows[0].id, tokenHash, RESET_TTL_MINUTES],
    );
    return rows[0];
  });

  if (!staff) return; // no staff account for this email — stay silent

  await sendPasswordResetEmail({
    email:     normalized,
    resetUrl:  buildResetUrl(token),
    expiresIn: `${RESET_TTL_MINUTES} minutes`,
  });
}

/** Verifies the reset token and sets a new password in one step. Bumps session_version to invalidate any existing sessions. */
export async function resetAdminPasswordWithToken(token: string, newPassword: string): Promise<void> {
  const tokenHash = hashSecret(token.trim());

  await withAdminDb(async (db) => {
    const { rows } = await db.query<{
      id: string; reset_otp_expires_at: Date | null; platform_role: string; is_active: boolean;
    }>(
      `SELECT id, reset_otp_expires_at, platform_role, is_active
       FROM public.members WHERE reset_otp_hash = $1`,
      [tokenHash],
    );
    const staff = rows[0];
    if (!staff
        || !staff.is_active
        || !PLATFORM_ROLES.includes(staff.platform_role)
        || !staff.reset_otp_expires_at
        || staff.reset_otp_expires_at < new Date()) {
      throw new ValidationError(GENERIC_ERROR);
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await db.query(
      `UPDATE public.members
       SET password_hash = $2, reset_otp_hash = NULL, reset_otp_expires_at = NULL, reset_otp_attempts = 0,
           session_version = session_version + 1
       WHERE id = $1`,
      [staff.id, passwordHash],
    );
  });
}
