/**
 * POST /api/v1/auth/admin/login
 *
 * Backoffice login for platform staff (super_admin / support /
 * ngo_coordinator). Separate from the consumer /auth/login flow because:
 *
 *  - Email-only identity (staff don't authenticate by Kenyan phone).
 *  - No group-membership requirement (platform staff don't belong to a
 *    Chama; the consumer flow 403s them at the "no active memberships"
 *    check).
 *  - Issues a backoffice-audience JWT that the proxy enforces ONLY for
 *    /api/admin/* routes, while explicitly rejecting it on /api/v1/*.
 *  - Tighter token TTL (15m access / 8h refresh by default) — the blast
 *    radius of a stolen platform token is much larger than a member's.
 *
 * NOT INCLUDED in Phase 1:
 *  - MFA (Phase 2 — adds a second TOTP step before token issuance).
 *  - IP allowlist (Phase 6 — env-driven BACKOFFICE_ALLOWED_IPS).
 *  - Step-up auth for destructive actions (Phase 6).
 */
export const dynamic = 'force-dynamic';

import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { withAdminDb } from '@/lib/db';
import {
  signBackofficeAccessToken, signRefreshToken,
  hashToken, refreshTtlSeconds,
} from '@/lib/auth/jwt';
import {
  storeRefreshToken, incrementLoginAttempts, clearLoginAttempts,
  isAccountLocked, lockAccount,
} from '@/lib/redis';
import { AdminLoginSchema } from '@/lib/validators/auth.schema';
import { ok, handleError, errorResponse } from '@/lib/utils/response';
import type { AdminLoginResponse } from '@/types/api.types';

const MAX_ATTEMPTS    = parseInt(process.env.MAX_LOGIN_ATTEMPTS    ?? '5',  10);
const LOCKOUT_MINUTES = parseInt(process.env.LOGIN_LOCKOUT_MINUTES ?? '15', 10);

// Constant-time decoy hash: bcrypt.compare against this when the member
// lookup fails so the response timing doesn't reveal whether the email
// exists in the platform_role pool.
const DECOY_HASH = '$2a$10$abcdefghijklmnopqrstuuMUbfYNQK3vFq2KCRGzlz7QnxJ.O3.lG';

const PLATFORM_ROLES = ['super_admin', 'support', 'ngo_coordinator'] as const;
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

    // Lockout key is the email; one shared key with the consumer flow would
    // let a tenant attacker exhaust an admin's lockout budget by guessing
    // their phone. Different namespaces, different limiters.
    const lockKey = `admin:${email}`;
    if (await isAccountLocked(lockKey)) {
      return errorResponse(
        `Too many failed attempts. Account locked for ${LOCKOUT_MINUTES} minutes.`,
        'ACCOUNT_LOCKED',
        429,
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

      // Three failure modes collapsed into one ambiguous error so an
      // attacker can't distinguish: no member, deactivated, wrong password,
      // wrong platform role.
      if (!member
          || !member.is_active
          || !passwordOk
          || !PLATFORM_ROLES.includes(member.platform_role as AdminPlatformRole)) {
        return { kind: 'invalid' as const };
      }

      // ngo_coordinator scope lookup — find their NGO id so the JWT can
      // carry it. Other platform roles have no ngo scope.
      let ngoId: string | undefined;
      if (member.platform_role === 'ngo_coordinator') {
        const { rows: ngo } = await client.query<{ id: string }>(
          `SELECT id FROM ngos WHERE coordinator_member_id = $1 AND is_active = TRUE LIMIT 1`,
          [member.id],
        );
        ngoId = ngo[0]?.id;
        if (!ngoId) {
          // Coordinator account without an active NGO row = misconfigured.
          // Treat as invalid login rather than minting a useless token.
          return { kind: 'invalid' as const };
        }
      }

      return { kind: 'ok' as const, member, ngoId };
    });

    if (result.kind === 'invalid') {
      const attempts = await incrementLoginAttempts(lockKey);
      if (attempts >= MAX_ATTEMPTS) {
        await lockAccount(lockKey, LOCKOUT_MINUTES);
      }
      return errorResponse('Invalid email or password', 'INVALID_CREDENTIALS', 401);
    }

    const { member, ngoId } = result;
    await clearLoginAttempts(lockKey);

    void withAdminDb((client) =>
      client.query('UPDATE members SET last_login_at = NOW() WHERE id = $1', [member.id]),
    ).catch(() => {});

    const accessToken = signBackofficeAccessToken({
      sub:          member.id,
      aud:          'backoffice',
      platformRole: member.platform_role as AdminPlatformRole,
      ngoId,
    });

    const { token: refreshToken } = signRefreshToken(member.id, 'backoffice');
    const rtHash = hashToken(refreshToken);
    await storeRefreshToken(rtHash, member.id, refreshTtlSeconds('backoffice'));

    await withAdminDb((client) =>
      client.query(
        `INSERT INTO refresh_tokens (member_id, token_hash, expires_at, ip_address)
         VALUES ($1, $2, NOW() + make_interval(secs => $3::int), $4)`,
        [member.id, rtHash, refreshTtlSeconds('backoffice'), req.headers.get('x-forwarded-for') ?? null],
      ),
    );

    const response: AdminLoginResponse = {
      accessToken,
      refreshToken,
      audience: 'backoffice',
      member: {
        id:           member.id,
        firstName:    member.first_name,
        lastName:     member.last_name,
        email:        member.email ?? email,
        platformRole: member.platform_role as AdminPlatformRole,
        ngoId,
      },
    };
    return ok(response);
  } catch (err) {
    return handleError(err);
  }
}
