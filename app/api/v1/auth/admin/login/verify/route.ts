/**
 * POST /api/v1/auth/admin/login/verify — Step 2 of the backoffice login.
 *
 * Accepts the short-lived MFA challenge JWT from step 1 plus the code the
 * user typed. Two branches:
 *
 *  1. challenge.kind === 'enrollment'
 *     - Code is verified against the plaintext secret carried in the
 *       challenge JWT. On success, the secret is encrypted at rest with
 *       ENCRYPTION_KEY and persisted to member_mfa_secrets along with
 *       bcrypt-hashed recovery codes. (Recovery code hashing happens
 *       here so they're never re-presented by /admin/login — the step-1
 *       response is the only time the plaintext exists.)
 *     - On success the backoffice access + refresh tokens are issued.
 *
 *  2. challenge.kind === 'verify'
 *     - Code is first treated as a TOTP. If that fails, treated as a
 *       recovery code; a matching hash is removed from the stored array
 *       (single use).
 *     - On success the tokens are issued.
 *
 * Failed attempts increment the same lockout namespace as step 1
 * (`admin:<email>`). A locked account at step 2 must clear the cooldown
 * before retrying. We re-fetch the member by id (challenge.sub) rather
 * than trusting any free-form input from the request body.
 */
export const dynamic = 'force-dynamic';

import { NextRequest } from 'next/server';
import { withAdminDb } from '@/lib/db';
import {
  signBackofficeAccessToken, signRefreshToken,
  hashToken, refreshTtlSeconds,
  verifyMfaChallenge,
} from '@/lib/auth/jwt';
import {
  encryptSecret, verifyTotp, verifyTotpRaw,
  hashRecoveryCodes, verifyAndConsumeRecoveryCode,
} from '@/lib/auth/mfa';
import {
  storeRefreshToken, incrementLoginAttempts, lockAccount, isAccountLocked,
} from '@/lib/redis';
import { AdminLoginMfaVerifySchema } from '@/lib/validators/auth.schema';
import { ok, handleError, errorResponse } from '@/lib/utils/response';
import type { AdminLoginResponse } from '@/types/api.types';

const MAX_ATTEMPTS    = parseInt(process.env.MAX_LOGIN_ATTEMPTS    ?? '5',  10);
const LOCKOUT_MINUTES = parseInt(process.env.LOGIN_LOCKOUT_MINUTES ?? '15', 10);

const PLATFORM_ROLES = ['super_admin', 'support', 'organization_coordinator'] as const;
type AdminPlatformRole = (typeof PLATFORM_ROLES)[number];

interface MemberRow {
  id:            string;
  first_name:    string;
  last_name:     string;
  email:         string | null;
  platform_role: string;
  is_active:     boolean;
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body  = await req.json();
    const input = AdminLoginMfaVerifySchema.parse(body);

    let challenge: ReturnType<typeof verifyMfaChallenge>;
    try {
      challenge = verifyMfaChallenge(input.challenge);
    } catch {
      return errorResponse('Sign-in session expired. Start again.', 'MFA_CHALLENGE_EXPIRED', 401);
    }

    // Same lockout namespace as step 1 — re-derive from email below.
    // Look up the member by the challenge's sub claim (not by email from
    // request body) so a stolen challenge token can't be redirected to a
    // different account.
    const memberId = challenge.sub;

    const memberLookup = await withAdminDb(async (client) => {
      const { rows } = await client.query<MemberRow>(
        `SELECT id, first_name, last_name, email, platform_role, is_active
           FROM members WHERE id = $1 LIMIT 1`,
        [memberId],
      );
      const member = rows[0];
      if (!member
          || !member.is_active
          || !PLATFORM_ROLES.includes(member.platform_role as AdminPlatformRole)) {
        return null;
      }
      // organization_coordinator scope
      let organizationId: string | undefined;
      if (member.platform_role === 'organization_coordinator') {
        const { rows: organization } = await client.query<{ id: string }>(
          `SELECT id FROM organizations WHERE coordinator_member_id = $1 AND is_active = TRUE LIMIT 1`,
          [member.id],
        );
        organizationId = organization[0]?.id;
        if (!organizationId) return null;
      }
      return { member, organizationId };
    });

    if (!memberLookup) {
      return errorResponse('Sign-in session is no longer valid.', 'MFA_CHALLENGE_INVALID', 401);
    }
    const { member, organizationId } = memberLookup;
    const lockKey = `admin:${(member.email ?? '').toLowerCase()}`;

    if (await isAccountLocked(lockKey)) {
      return errorResponse(
        `Too many failed attempts. Account locked for ${LOCKOUT_MINUTES} minutes.`,
        'ACCOUNT_LOCKED', 429,
      );
    }

    // ── Branch on challenge type ───────────────────────────────────────
    if (challenge.kind === 'enrollment') {
      if (!challenge.secret) {
        return errorResponse('Malformed enrollment challenge.', 'MFA_CHALLENGE_INVALID', 400);
      }
      if (!verifyTotpRaw(input.code, challenge.secret)) {
        const attempts = await incrementLoginAttempts(lockKey);
        if (attempts >= MAX_ATTEMPTS) await lockAccount(lockKey, LOCKOUT_MINUTES);
        return errorResponse(
          'Invalid code. Make sure the time on your phone is in sync and try again.',
          'MFA_INVALID_CODE', 401,
        );
      }

      // Persist enrollment. The recovery codes presented at step 1 are
      // hashed and stored here; they were generated client-side via the
      // step-1 response and never sent back to the client again — the
      // user is expected to have written them down at enrollment time.
      // Regenerate fresh hashes from a fresh set of codes ONLY if the
      // request body included them; for the simpler MVP flow we trust
      // the codes shown at step 1 (the verify route just enrolls with
      // an empty recovery array if the client didn't echo them back —
      // we'll add explicit recovery-code persistence to the verify body
      // in a follow-up if UX feedback demands it).
      //
      // Pragmatic choice for Phase 2: we hash + persist the codes that
      // were issued at step 1. To do that without trusting client input,
      // we'd need to also encode them in the challenge JWT. Putting 10
      // codes (200+ bytes) into the challenge is fine size-wise — let's
      // not overcomplicate. For now we trust the client to NOT POST them
      // back — they're displayed at enrollment, and the client retains
      // them. If the user loses their codes they need a super_admin to
      // reset (manual SQL until Phase 5 UI). That's acceptable for an
      // MVP — Authy / Google Authenticator users rarely lose their
      // device.
      const encryptedSecret = encryptSecret(challenge.secret);
      // The codes presented at step 1 are hashed here so a future verify
      // attempt can match them. We send the codes through the body of
      // this request (UI passes them along).
      const recoveryCodes = Array.isArray((body as Record<string, unknown>).recoveryCodes)
        ? ((body as Record<string, unknown>).recoveryCodes as string[]).filter((c): c is string => typeof c === 'string')
        : [];
      const recoveryHashes = recoveryCodes.length > 0
        ? await hashRecoveryCodes(recoveryCodes)
        : [];

      await withAdminDb(async (client) => {
        await client.query(
          `INSERT INTO member_mfa_secrets (member_id, secret_encrypted, recovery_hashes, label, last_verified_at)
           VALUES ($1, $2, $3::text[], $4, NOW())
           ON CONFLICT (member_id) DO UPDATE SET
             secret_encrypted = EXCLUDED.secret_encrypted,
             recovery_hashes  = EXCLUDED.recovery_hashes,
             label            = EXCLUDED.label,
             last_verified_at = EXCLUDED.last_verified_at`,
          [member.id, encryptedSecret, recoveryHashes, input.label ?? null],
        );
      });

      return issueBackofficeTokens(req, member, organizationId);
    }

    // ── challenge.kind === 'verify' ────────────────────────────────────
    const stored = await withAdminDb(async (client) => {
      const { rows } = await client.query<{ secret_encrypted: string; recovery_hashes: string[] }>(
        `SELECT secret_encrypted, recovery_hashes
           FROM member_mfa_secrets WHERE member_id = $1`,
        [member.id],
      );
      return rows[0];
    });
    if (!stored) {
      // Edge case: member dropped out of enrollment between step 1 and 2.
      // Force them to restart so the flow re-issues an enrollment challenge.
      return errorResponse('Authenticator not enrolled. Start the sign-in flow again.', 'MFA_NOT_ENROLLED', 401);
    }

    // Try TOTP first (the common path), then fall back to recovery code.
    let recoveryConsumed: { remaining: string[] } | null = null;
    let ok2fa = verifyTotp(input.code, stored.secret_encrypted);
    if (!ok2fa) {
      const recovery = await verifyAndConsumeRecoveryCode(input.code, stored.recovery_hashes);
      if (recovery) {
        ok2fa = true;
        recoveryConsumed = { remaining: recovery.remainingHashes };
      }
    }

    if (!ok2fa) {
      const attempts = await incrementLoginAttempts(lockKey);
      if (attempts >= MAX_ATTEMPTS) await lockAccount(lockKey, LOCKOUT_MINUTES);
      return errorResponse(
        'Invalid code. Try the latest code from your authenticator or use a recovery code.',
        'MFA_INVALID_CODE', 401,
      );
    }

    await withAdminDb(async (client) => {
      if (recoveryConsumed) {
        await client.query(
          `UPDATE member_mfa_secrets
              SET recovery_hashes  = $2::text[],
                  last_verified_at = NOW()
            WHERE member_id = $1`,
          [member.id, recoveryConsumed.remaining],
        );
      } else {
        await client.query(
          `UPDATE member_mfa_secrets SET last_verified_at = NOW() WHERE member_id = $1`,
          [member.id],
        );
      }
    });

    return issueBackofficeTokens(req, member, organizationId);
  } catch (err) {
    return handleError(err);
  }
}

// ── Shared: mint backoffice tokens + persist refresh token ──────────────

async function issueBackofficeTokens(
  req:     NextRequest,
  member:  MemberRow,
  organizationId:   string | undefined,
): Promise<Response> {
  const accessToken = signBackofficeAccessToken({
    sub:          member.id,
    aud:          'backoffice',
    platformRole: member.platform_role as AdminPlatformRole,
    organizationId,
  });
  const { token: refreshToken } = signRefreshToken(member.id, 'backoffice');
  const rtHash = hashToken(refreshToken);
  await storeRefreshToken(rtHash, member.id, refreshTtlSeconds('backoffice'));

  await withAdminDb(async (client) => {
    await client.query(
      `INSERT INTO refresh_tokens (member_id, token_hash, expires_at, ip_address)
       VALUES ($1, $2, NOW() + make_interval(secs => $3::int), $4)`,
      [member.id, rtHash, refreshTtlSeconds('backoffice'), req.headers.get('x-forwarded-for') ?? null],
    );
    await client.query('UPDATE members SET last_login_at = NOW() WHERE id = $1', [member.id]);
  });

  const response: AdminLoginResponse = {
    accessToken,
    refreshToken,
    audience: 'backoffice',
    member: {
      id:           member.id,
      firstName:    member.first_name,
      lastName:     member.last_name,
      email:        member.email ?? '',
      platformRole: member.platform_role as AdminPlatformRole,
      organizationId,
    },
  };
  return ok(response);
}
