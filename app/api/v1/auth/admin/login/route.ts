/**
 * POST /api/v1/auth/admin/login — Step 1 of the backoffice login flow.
 *
 * Validates email + password + platform role. Then branches on MFA state:
 *
 *  - Member has NEVER enrolled an authenticator:
 *      Generate a fresh TOTP secret, build a QR data URL + 10 recovery
 *      codes, sign a 5-minute "enrollment challenge" JWT that carries the
 *      plaintext secret inside it. Return all of the above to the UI. The
 *      UI shows the QR, the user scans it, then re-submits the code +
 *      challenge to /admin/login/verify, which persists the enrollment
 *      and issues the real backoffice access token.
 *
 *  - Member IS enrolled:
 *      Sign a 5-minute "verify challenge" JWT (sub-only). Return it. UI
 *      prompts for the current TOTP code (or a recovery code) and
 *      re-submits to /admin/login/verify.
 *
 * Tokens are never issued from this endpoint — only from /verify after
 * the MFA step completes.
 *
 * Lockout namespace is `admin:<email>` so consumer attackers can't burn
 * an admin's lockout budget by guessing their phone. Decoy bcrypt
 * compare prevents email enumeration.
 */
export const dynamic = 'force-dynamic';

import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { withAdminDb } from '@/lib/db';
import { env } from '@/lib/env';
import { signMfaChallenge } from '@/lib/auth/jwt';
import {
  generateTotpSecret, buildOtpAuthQrCode,
  generateRecoveryCodes,
} from '@/lib/auth/mfa';
import {
  incrementLoginAttempts, clearLoginAttempts,
  isAccountLocked, lockAccount,
} from '@/lib/redis';
import { AdminLoginSchema } from '@/lib/validators/auth.schema';
import { ok, handleError, errorResponse } from '@/lib/utils/response';
import type {
  AdminLoginEnrollmentChallenge, AdminLoginMfaChallenge, AdminLoginResult,
} from '@/types/api.types';

// OPTIMIZATION_CLEANUP_AUDIT.md High #11 — see app/api/v1/auth/login/route.ts's
// identical comment; this used to disagree with the validated schema default.
const MAX_ATTEMPTS    = env.MAX_LOGIN_ATTEMPTS;
const LOCKOUT_MINUTES = env.LOGIN_LOCKOUT_MINUTES;

const DECOY_HASH = '$2a$10$abcdefghijklmnopqrstuuMUbfYNQK3vFq2KCRGzlz7QnxJ.O3.lG';

const PLATFORM_ROLES = ['super_admin', 'support', 'organization_coordinator'] as const;
type AdminPlatformRole = (typeof PLATFORM_ROLES)[number];

interface AdminMemberRow {
  id:            string;
  password_hash: string;
  first_name:    string;
  last_name:     string;
  email:         string | null;
  platform_role: string;
  is_active:     boolean;
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body  = await req.json();
    const input = AdminLoginSchema.parse(body);
    const email = input.email.trim().toLowerCase();

    const lockKey = `admin:${email}`;
    if (await isAccountLocked(lockKey)) {
      return errorResponse(
        `Too many failed attempts. Account locked for ${LOCKOUT_MINUTES} minutes.`,
        'ACCOUNT_LOCKED', 429,
      );
    }

    const result = await withAdminDb(async (client) => {
      const { rows } = await client.query<AdminMemberRow>(
        `SELECT id, password_hash, first_name, last_name, email,
                platform_role, is_active
           FROM members
          WHERE lower(email) = $1
          LIMIT 1`,
        [email],
      );
      const member = rows[0];
      const hashToVerify = member?.password_hash ?? DECOY_HASH;
      const passwordOk   = await bcrypt.compare(input.password, hashToVerify);

      // Collapse "member missing / deactivated / wrong password / not a
      // platform role" into a single ambiguous failure so an attacker
      // can't enumerate emails or platform-role assignments.
      if (!member
          || !member.is_active
          || !passwordOk
          || !PLATFORM_ROLES.includes(member.platform_role as AdminPlatformRole)) {
        return { kind: 'invalid' as const };
      }

      // Look up existing MFA enrollment, if any.
      const { rows: mfa } = await client.query<{ member_id: string }>(
        `SELECT member_id FROM member_mfa_secrets WHERE member_id = $1`,
        [member.id],
      );
      const enrolled = mfa.length > 0;
      return { kind: 'ok' as const, member, enrolled };
    });

    if (result.kind === 'invalid') {
      const attempts = await incrementLoginAttempts(lockKey);
      if (attempts >= MAX_ATTEMPTS) {
        await lockAccount(lockKey, LOCKOUT_MINUTES);
      }
      return errorResponse('Invalid email or password', 'INVALID_CREDENTIALS', 401);
    }

    const { member, enrolled } = result;
    // Reset the password-attempt counter; the user still has to pass MFA,
    // but we don't want a transient TOTP retry counting against the
    // password-attempt budget.
    await clearLoginAttempts(lockKey);

    if (enrolled) {
      // Step-1 done. UI prompts for a TOTP / recovery code next.
      const challenge = signMfaChallenge({ sub: member.id, kind: 'verify' });
      const response: AdminLoginMfaChallenge = { needsMfaCode: true, challenge };
      return ok<AdminLoginResult>(response);
    }

    // First-time enrollment: generate secret + QR + recovery codes. The
    // plaintext secret rides inside the signed challenge JWT so the verify
    // endpoint can persist it after the code confirms.
    const secret        = generateTotpSecret();
    const accountLabel  = member.email ?? email;
    const qrCodeDataUrl = await buildOtpAuthQrCode(accountLabel, secret);
    const recoveryCodes = generateRecoveryCodes();

    const challenge = signMfaChallenge({
      sub:    member.id,
      kind:   'enrollment',
      secret,
    });

    const response: AdminLoginEnrollmentChallenge = {
      needsMfaEnrollment: true,
      challenge,
      secret,
      qrCodeDataUrl,
      recoveryCodes,
      accountLabel,
    };
    return ok<AdminLoginResult>(response);
  } catch (err) {
    return handleError(err);
  }
}
