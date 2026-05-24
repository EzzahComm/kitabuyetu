import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '@/lib/env';
import type { MemberRole, PlatformRole } from '@/types/enums';

interface AccessTokenPayload {
  sub:        string;  // member id (auth identity)
  groupId:    string;  // active group context (one of the member's group_members rows)
  role:       MemberRole | PlatformRole;
  personId?:  string;  // shared cross-group identity (since Phase A); optional for
                       // pre-Phase-A tokens still in circulation
  ngoId?:     string;
}

interface RefreshTokenPayload {
  sub:  string;  // userId
  type: 'refresh';
  jti:  string;  // unique token ID for revocation
}

// Validated at module load by lib/env.ts — no need for a second null check here.
const ACCESS_SECRET  = env.JWT_SECRET;
// Prefer a dedicated refresh secret so access tokens cannot be accepted where
// a refresh token is expected (and vice versa) even if one key leaks.
const REFRESH_SECRET = env.JWT_REFRESH_SECRET ?? env.JWT_SECRET;
const ACCESS_TTL     = env.JWT_ACCESS_EXPIRES_IN;
const REFRESH_TTL    = env.JWT_REFRESH_EXPIRES_IN;

// Algorithm is pinned explicitly to prevent algorithm-confusion attacks.
// Tokens signed with RS256/none/other will be rejected by verify().
const ALGORITHM = 'HS256' as const;

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, ACCESS_SECRET, {
    algorithm: ALGORITHM,
    expiresIn: ACCESS_TTL,
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload & { iat: number; exp: number } {
  return jwt.verify(token, ACCESS_SECRET, {
    algorithms: [ALGORITHM],
  }) as AccessTokenPayload & { iat: number; exp: number };
}

export function signRefreshToken(userId: string): { token: string; jti: string } {
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    { sub: userId, type: 'refresh', jti } satisfies RefreshTokenPayload,
    REFRESH_SECRET,
    { algorithm: ALGORITHM, expiresIn: REFRESH_TTL } as jwt.SignOptions,
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

/** Parse refresh TTL string into seconds. */
export function refreshTtlSeconds(): number {
  const ttl = REFRESH_TTL;
  if (ttl.endsWith('d')) return parseInt(ttl) * 86400;
  if (ttl.endsWith('h')) return parseInt(ttl) * 3600;
  if (ttl.endsWith('m')) return parseInt(ttl) * 60;
  return parseInt(ttl);
}
