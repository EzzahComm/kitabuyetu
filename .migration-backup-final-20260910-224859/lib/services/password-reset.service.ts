/**
 * Self-service forgot-password (§8 item 6 of the UX audit follow-up).
 * Reuses the exact SMS-OTP crypto pattern proven twice already
 * (group-verification.service.ts, organization-members.service.ts's invite
 * flow) rather than inventing a new one. Public/unauthenticated by design —
 * a visitor who forgot their password has no session — so every query goes
 * through withAdminDb, same as those two flows.
 *
 * Enumeration-safe: startPasswordReset() never reveals whether a phone
 * number belongs to an account (always resolves without error), and
 * resetPasswordWithOtp() uses the same generic error message whether the
 * phone doesn't exist, the OTP is wrong, or the OTP expired.
 */
import bcrypt from 'bcryptjs';
import { withAdminDb } from '@/lib/db';
import { normalizePhone } from '@/lib/utils/phone';
import { ValidationError } from '@/lib/utils/errors';
import { hashSecret, generateOtp } from './group-verification.service';
import { sendServiceSms } from './notifications.service';
import { BCRYPT_ROUNDS } from './members.service';

const OTP_TTL_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 5;
const GENERIC_ERROR = 'Invalid or expired code';

/** Always resolves without error, whether or not the phone is registered — never reveals account existence. */
export async function startPasswordReset(phone: string): Promise<void> {
  const normalized = normalizePhone(phone);
  const otp = generateOtp();
  const otpHash = hashSecret(otp);

  const member = await withAdminDb(async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM public.members WHERE phone = $1 AND is_active = true`,
      [normalized],
    );
    if (!rows[0]) return null;

    await db.query(
      `UPDATE public.members
       SET reset_otp_hash = $2, reset_otp_expires_at = NOW() + make_interval(mins => $3), reset_otp_attempts = 0
       WHERE id = $1`,
      [rows[0].id, otpHash, OTP_TTL_MINUTES],
    );
    return rows[0];
  });

  if (!member) return; // no account for this phone — stay silent

  // sendServiceSms, not sendSingleSms: it writes a platform-funded ledger row
  // (so the cost is visible) and never throws. The previous unguarded provider
  // call was reachable only for phone numbers that DO exist — line 48 returns
  // early otherwise — so a provider outage threw only for real accounts,
  // contradicting this function's own "always resolves without error" contract
  // and leaking account existence.
  await sendServiceSms({
    phone:    normalized,
    memberId: member.id,
    notificationType: 'auth_password_reset',
    body: `Your Kitabu Yetu password reset code is ${otp}. It expires in ${OTP_TTL_MINUTES} minutes. If you did not request this, ignore this SMS.`,
  });
}

/** Verifies the OTP and sets a new password in one step. Bumps session_version to invalidate any existing sessions. */
export async function resetPasswordWithOtp(phone: string, otp: string, newPassword: string): Promise<void> {
  const normalized = normalizePhone(phone);
  const otpHash = hashSecret(otp.trim());

  await withAdminDb(async (db) => {
    const { rows } = await db.query<{
      id: string; reset_otp_hash: string | null; reset_otp_expires_at: Date | null; reset_otp_attempts: number;
    }>(
      `SELECT id, reset_otp_hash, reset_otp_expires_at, reset_otp_attempts
       FROM public.members WHERE phone = $1 AND is_active = true`,
      [normalized],
    );
    const member = rows[0];
    if (!member || !member.reset_otp_hash || !member.reset_otp_expires_at) {
      throw new ValidationError(GENERIC_ERROR);
    }
    if (member.reset_otp_expires_at < new Date()) throw new ValidationError(GENERIC_ERROR);
    if (member.reset_otp_attempts >= MAX_OTP_ATTEMPTS) throw new ValidationError(GENERIC_ERROR);

    if (member.reset_otp_hash !== otpHash) {
      await db.query(
        `UPDATE public.members SET reset_otp_attempts = reset_otp_attempts + 1 WHERE id = $1`,
        [member.id],
      );
      throw new ValidationError(GENERIC_ERROR);
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await db.query(
      `UPDATE public.members
       SET password_hash = $2, reset_otp_hash = NULL, reset_otp_expires_at = NULL, reset_otp_attempts = 0,
           session_version = session_version + 1
       WHERE id = $1`,
      [member.id, passwordHash],
    );
  });
}
