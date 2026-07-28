/**
 * Registrant verification (§4A, migration 046) — the piece that was missing
 * between register_group() landing new groups at status='pending_verification'
 * and the DB-side RPCs (start_registrant_verification /
 * complete_registrant_verification / complete_email_verification) that were
 * built to move them to 'active'. Nothing in app/api ever called those RPCs,
 * so every group created since migration 046 shipped was permanently stuck —
 * proxy.ts blocks every feature route for a pending_verification group, and
 * there was no route or page that could clear the status.
 */
import crypto from 'crypto';
import { withAdminDb } from '@/lib/db';
import { sendTemplatedEmail } from './email.service';
import { sendSingleSms } from './textsms.service';
import { AppError } from '@/lib/utils/errors';

export type VerificationChannel = 'email' | 'sms';

interface GroupContactInfo {
  groupId:    string;
  groupName:  string;
  groupCode:  string;
  memberName: string;
  email:      string | null;
  phone:      string;
}

export function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

export function generateEmailToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function generateOtp(): string {
  return String(crypto.randomInt(100_000, 1_000_000)); // 6 digits, zero-padding not needed
}

function verifyUrlFor(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://kitabuyetu.vercel.app').replace(/\/$/, '');
  return `${base}/verify-group/confirm?token=${token}`;
}

/**
 * Starts a verification attempt: writes the hashed secret via the
 * start_registrant_verification RPC (which also invalidates any prior open
 * attempt for this group), then dispatches the plaintext secret AFTER that
 * commits — a transient email/SMS provider outage never destroys the DB
 * state; the registrant can just request another send.
 */
export async function startGroupVerification(
  info: GroupContactInfo,
  channel: VerificationChannel,
): Promise<{ expiresAt: string }> {
  const destination = channel === 'email' ? info.email : info.phone;
  if (!destination) {
    throw new AppError('No email address on file for this group', 'NO_EMAIL_ON_FILE', 400);
  }

  const secret     = channel === 'email' ? generateEmailToken() : generateOtp();
  const secretHash = hashSecret(secret);

  const { expires_at: expiresAt } = await withAdminDb(async (client) => {
    const { rows } = await client.query<{ result: { id: string; expires_at: string } }>(
      'SELECT start_registrant_verification($1, $2, $3, $4) AS result',
      [info.groupId, channel, destination, secretHash],
    );
    return rows[0].result;
  });

  if (channel === 'email') {
    await sendTemplatedEmail({
      templateKey: 'group_verification_link',
      to:          destination,
      vars: {
        name:      info.memberName,
        groupName: info.groupName,
        groupCode: info.groupCode,
        verifyUrl: verifyUrlFor(secret),
      },
      groupId: info.groupId,
    });
  } else {
    await sendSingleSms({
      mobile:  destination,
      message: `Your Kitabu Yetu verification code is ${secret}. It expires in 10 minutes. If you did not request this, ignore this SMS.`,
    });
  }

  return { expiresAt };
}

/** Authenticated SMS-OTP completion path. Throws the RPC's raw PG error on failure (OTP_INVALID / OTP_EXPIRED / OTP_TOO_MANY_ATTEMPTS) — callers map these to user-facing copy. */
export async function completeGroupVerificationAuthed(groupId: string, code: string): Promise<void> {
  const secretHash = hashSecret(code);
  await withAdminDb(async (client) => {
    await client.query('SELECT complete_registrant_verification($1, $2, $3)', [groupId, 'sms', secretHash]);
  });
}

/** Public email-link completion path — the token itself is the proof, no auth required. Throws LINK_INVALID / LINK_EXPIRED on failure. */
export async function completeGroupVerificationByToken(token: string): Promise<{ groupId: string }> {
  const secretHash = hashSecret(token);
  return withAdminDb(async (client) => {
    const { rows } = await client.query<{ result: { group_id: string } }>(
      'SELECT complete_email_verification($1) AS result',
      [secretHash],
    );
    return { groupId: rows[0].result.group_id };
  });
}
