import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '@/lib/env';
import type { MemberRole, PlatformRole } from '@/types/enums';

// ── Audience marker (Phase 1 of backoffice isolation) ──────────────────
// Tenant tokens are issued by /api/v1/auth/login and carry group context.
// Backoffice tokens are issued by /api/v1/auth/admin/login and carry
// platform-staff context (no group). The proxy enforces audience per URL
// prefix: /api/v1/* requires 'tenant', /api/admin/* requires 'backoffice'.
// Legacy tokens without an `aud` claim are treated as 'tenant' for backward
// compatibility (will be phased out as TTLs expire).
export type TokenAudience = 'tenant' | 'backoffice';

export interface TenantAccessTokenPayload {
  sub:         string;            // member id
  aud?:        'tenant';          // optional for backward compat
  groupId:     string;            // active group context
  role:        MemberRole | PlatformRole;
  personId?:   string;            // shared cross-group identity (since Phase A)
  ngoId?:      string;
  // Phase D Part 2 — group lifecycle. The proxy gates non-verify routes when
  // this is 'pending_verification'. Optional for backward compatibility with
  // tokens issued before this field existed (they're treated as 'active').
  groupStatus?: string;
}

export interface BackofficeAccessTokenPayload {
  sub:          string;          // member id
  aud:          'backoffice';
  platformRole: PlatformRole;    // super_admin | support | ngo_coordinator
  ngoId?:       string;          // scope for ngo_coordinator
}

export type AccessTokenPayload = TenantAccessTokenPayload | BackofficeAccessTokenPayload;

interface RefreshTokenPayload {
  sub:  string;
  type: 'refresh';
  jti:  string;
  aud?: TokenAudience;           // mirror access-token audience so refreshes don't cross
}

// Validated at module load by lib/env.ts — no need for a second null check here.
const ACCESS_SECRET  = env.JWT_SECRET;
// Prefer a dedicated refresh secret so access tokens cannot be accepted where
// a refresh token is expected (and vice versa) even if one key leaks.
const REFRESH_SECRET = env.JWT_REFRESH_SECRET ?? env.JWT_SECRET;
const ACCESS_TTL     = env.JWT_ACCESS_EXPIRES_IN;
const REFRESH_TTL    = env.JWT_REFRESH_EXPIRES_IN;
// Backoffice tokens have a tighter TTL to bound stolen-token blast radius
// for the highest-privilege accounts. Phase 1 default; revisit if it hurts UX.
const BACKOFFICE_ACCESS_TTL  = env.BACKOFFICE_ACCESS_EXPIRES_IN  ?? '15m';
const BACKOFFICE_REFRESH_TTL = env.BACKOFFICE_REFRESH_EXPIRES_IN ?? '8h';

// Algorithm is pinned explicitly to prevent algorithm-confusion attacks.
// Tokens signed with RS256/none/other will be rejected by verify().
const ALGORITHM = 'HS256' as const;

/** Sign a tenant-audience access token (consumer login flow). */
export function signAccessToken(payload: TenantAccessTokenPayload): string {
  const withAud: TenantAccessTokenPayload = { ...payload, aud: 'tenant' };
  return jwt.sign(withAud, ACCESS_SECRET, {
    algorithm: ALGORITHM,
    expiresIn: ACCESS_TTL,
  } as jwt.SignOptions);
}

/** Sign a backoffice-audience access token (platform staff login flow). */
export function signBackofficeAccessToken(payload: BackofficeAccessTokenPayload): string {
  return jwt.sign(payload, ACCESS_SECRET, {
    algorithm: ALGORITHM,
    expiresIn: BACKOFFICE_ACCESS_TTL,
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload & { iat: number; exp: number } {
  return jwt.verify(token, ACCESS_SECRET, {
    algorithms: [ALGORITHM],
  }) as AccessTokenPayload & { iat: number; exp: number };
}

export function signRefreshToken(
  userId: string,
  audience: TokenAudience = 'tenant',
): { token: string; jti: string } {
  const jti = crypto.randomUUID();
  const ttl = audience === 'backoffice' ? BACKOFFICE_REFRESH_TTL : REFRESH_TTL;
  const token = jwt.sign(
    { sub: userId, type: 'refresh', jti, aud: audience } satisfies RefreshTokenPayload,
    REFRESH_SECRET,
    { algorithm: ALGORITHM, expiresIn: ttl } as jwt.SignOptions,
  );
  return { token, jti };
}

export function verifyRefreshToken(token: string): RefreshTokenPayload & { iat: number; exp: number } {
  const payload = jwt.verify(token, REFRESH_SECRET, {
    algorithms: [ALGORITHM],
  }) as RefreshTokenPayload & { iat: number; exp: number };
  if (payload.type !== 'refresh') {
    throw new Error('Invalid token type');
  }
  return payload;
}

/** Hash a refresh token for storage (never store raw tokens). */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Parse a TTL string ("15m" / "8h" / "7d") into seconds. */
function ttlToSeconds(ttl: string): number {
  if (ttl.endsWith('d')) return parseInt(ttl) * 86400;
  if (ttl.endsWith('h')) return parseInt(ttl) * 3600;
  if (ttl.endsWith('m')) return parseInt(ttl) * 60;
  return parseInt(ttl);
}

/** Refresh TTL for tenant tokens, in seconds. */
export function refreshTtlSeconds(audience: TokenAudience = 'tenant'): number {
  return ttlToSeconds(audience === 'backoffice' ? BACKOFFICE_REFRESH_TTL : REFRESH_TTL);
}

// ── MFA challenge token (Phase 2) ───────────────────────────────────────
// Issued at step 1 of backoffice login (after password OK). Carries:
//   - sub:       member id
//   - aud:       'backoffice_mfa' (distinct audience so it CANNOT be used
//                anywhere except /admin/login/verify)
//   - kind:      'enrollment' (first-time enroll) or 'verify' (existing user)
//   - secret:    plaintext base32 secret — ONLY on enrollment challenges
//                so the verify route can persist it after the code confirms
//   - exp:       5 minutes
// TTL is short to bound the window where a stolen step-1 response is useful.

const MFA_CHALLENGE_TTL_SECONDS = 5 * 60;

export type MfaChallengeKind = 'enrollment' | 'verify';

interface MfaChallengePayload {
  sub:    string;
  aud:    'backoffice_mfa';
  kind:   MfaChallengeKind;
  secret?: string; // only present when kind === 'enrollment'
}

export function signMfaChallenge(payload: Omit<MfaChallengePayload, 'aud'>): string {
  return jwt.sign(
    { ...payload, aud: 'backoffice_mfa' } satisfies MfaChallengePayload,
    ACCESS_SECRET,
    { algorithm: ALGORITHM, expiresIn: MFA_CHALLENGE_TTL_SECONDS } as jwt.SignOptions,
  );
}

export function verifyMfaChallenge(token: string): MfaChallengePayload & { iat: number; exp: number } {
  const decoded = jwt.verify(token, ACCESS_SECRET, {
    algorithms: [ALGORITHM],
  }) as MfaChallengePayload & { iat: number; exp: number };
  if (decoded.aud !== 'backoffice_mfa') {
    throw new Error('Invalid MFA challenge audience');
  }
  return decoded;
}
