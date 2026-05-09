import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import type { MemberRole, PlatformRole } from '@/types/enums';

interface AccessTokenPayload {
  sub:     string;  // userId
  groupId: string;
  role:    MemberRole | PlatformRole;
  ngoId?:  string;
}

interface RefreshTokenPayload {
  sub:  string;  // userId
  type: 'refresh';
  jti:  string;  // unique token ID for revocation
}

const ACCESS_SECRET  = process.env.JWT_SECRET!;
const REFRESH_SECRET = process.env.JWT_SECRET!;
const ACCESS_TTL     = process.env.JWT_ACCESS_EXPIRES_IN  ?? '15m';
const REFRESH_TTL    = process.env.JWT_REFRESH_EXPIRES_IN ?? '7d';

if (!ACCESS_SECRET) {
  throw new Error('JWT_SECRET must be set');
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_TTL } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload & { iat: number; exp: number } {
  return jwt.verify(token, ACCESS_SECRET) as AccessTokenPayload & { iat: number; exp: number };
}

export function signRefreshToken(userId: string): { token: string; jti: string } {
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    { sub: userId, type: 'refresh', jti } satisfies RefreshTokenPayload,
    REFRESH_SECRET,
    { expiresIn: REFRESH_TTL } as jwt.SignOptions,
  );
  return { token, jti };
}

export function verifyRefreshToken(token: string): RefreshTokenPayload & { iat: number; exp: number } {
  const payload = jwt.verify(token, REFRESH_SECRET) as RefreshTokenPayload & { iat: number; exp: number };
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
