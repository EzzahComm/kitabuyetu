import { Redis } from '@upstash/redis';
import { logger } from '@/lib/logger';

// Parse REST URL and token from the REDIS_URL connection string.
// Both formats are accepted:
//   rediss://default:TOKEN@host.upstash.io:6380  (Upstash Redis URL)
//   https://host.upstash.io                      (Upstash REST URL — token via REDIS_TOKEN)
function buildRedisClient(): Redis {
  const raw = process.env.REDIS_URL;
  if (!raw) throw new Error('REDIS_URL environment variable is not set');

  try {
    const u = new URL(raw);
    const token = u.password || process.env.REDIS_TOKEN || '';
    const restUrl = `https://${u.hostname}`;
    return new Redis({ url: restUrl, token });
  } catch {
    throw new Error(`REDIS_URL is not a valid URL: ${raw}`);
  }
}

const globalWithRedis = globalThis as typeof globalThis & { _kyRedis?: Redis };

if (!globalWithRedis._kyRedis) {
  globalWithRedis._kyRedis = buildRedisClient();
}

export const redis = globalWithRedis._kyRedis;

// ------------------------------------------------------------------
// Typed key namespaces — prevents key collisions across modules
// ------------------------------------------------------------------
export const keys = {
  refreshToken:  (tokenHash: string)       => `rt:${tokenHash}`,
  loginAttempts: (phone: string)           => `login_attempts:${phone}`,
  accountLock:   (phone: string)           => `account_lock:${phone}`,
  smsQueue:      (groupId: string)         => `sms_queue:${groupId}`,
  mpesaStatus:   (checkoutReqId: string)   => `mpesa:${checkoutReqId}`,
  stkLock:       (fingerprint: string)     => `stk_lock:${fingerprint}`,
  rateLimit:     (ip: string)              => `rl:${ip}`,
  sessionCache:  (userId: string)          => `session:${userId}`,
};

const PREFIX = process.env.REDIS_PREFIX ?? 'ky:';
const k = (key: string) => `${PREFIX}${key}`;

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

export async function storeRefreshToken(
  tokenHash: string,
  userId: string,
  ttlSeconds: number,
): Promise<void> {
  await redis.set(k(keys.refreshToken(tokenHash)), userId, { ex: ttlSeconds });
}

export async function getRefreshToken(tokenHash: string): Promise<string | null> {
  return redis.get<string>(k(keys.refreshToken(tokenHash)));
}

export async function revokeRefreshToken(tokenHash: string): Promise<void> {
  await redis.del(k(keys.refreshToken(tokenHash)));
}

/**
 * Delete every stored refresh token, forcing all users to log in again.
 *
 * Redis — not the refresh_tokens table — is what POST /auth/refresh consults,
 * so this is the only place a refresh token can actually be invalidated.
 * Used at release boundaries where a token's claims become unusable (e.g. the
 * member_role rename in migration 050).
 *
 * SCAN rather than KEYS: the token namespace can be large and KEYS blocks.
 * Returns the number of keys removed.
 */
export async function revokeAllRefreshTokens(): Promise<number> {
  const pattern = k(keys.refreshToken('*'));
  let cursor = '0';
  let deleted = 0;

  do {
    const [next, batch] = await redis.scan(cursor, { match: pattern, count: 500 });
    cursor = String(next);
    if (batch.length) {
      await redis.del(...batch);
      deleted += batch.length;
    }
  } while (cursor !== '0');

  logger.info(`[redis] revoked ${deleted} refresh tokens`);
  return deleted;
}

export async function incrementLoginAttempts(phone: string): Promise<number> {
  const key = k(keys.loginAttempts(phone));
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, 60 * 60);
  }
  return count;
}

export async function clearLoginAttempts(phone: string): Promise<void> {
  await redis.del(k(keys.loginAttempts(phone)));
}

export async function getLoginAttempts(phone: string): Promise<number> {
  const val = await redis.get<string>(k(keys.loginAttempts(phone)));
  return val ? parseInt(val, 10) : 0;
}

export async function lockAccount(phone: string, minutes: number): Promise<void> {
  await redis.set(k(keys.accountLock(phone)), '1', { ex: minutes * 60 });
}

export async function isAccountLocked(phone: string): Promise<boolean> {
  const val = await redis.get(k(keys.accountLock(phone)));
  return val !== null;
}

export async function cacheMpesaStatus(
  checkoutRequestId: string,
  status: 'pending' | 'completed' | 'failed',
  ttlSeconds = 300,
): Promise<void> {
  await redis.set(k(keys.mpesaStatus(checkoutRequestId)), status, { ex: ttlSeconds });
}

export async function getMpesaStatus(
  checkoutRequestId: string,
): Promise<'pending' | 'completed' | 'failed' | null> {
  return redis.get<'pending' | 'completed' | 'failed'>(k(keys.mpesaStatus(checkoutRequestId)));
}

/**
 * STK Push duplicate-submit guard. Acquires a short-lived lock keyed on
 * (groupId, phone, amount, purpose) via SET NX. Returns true when acquired;
 * false when an identical prompt was initiated within the TTL window.
 * Fail-open: a Redis outage must never block payments, only dedup.
 */
export async function acquireStkLock(
  fingerprint: string,
  ttlSeconds = 30,
): Promise<boolean> {
  try {
    const res = await redis.set(k(keys.stkLock(fingerprint)), '1', { nx: true, ex: ttlSeconds });
    return res === 'OK';
  } catch (err) {
    logger.warn('[redis] STK lock unavailable — allowing request', { err: String(err) });
    return true;
  }
}

/** Releases the STK lock early (e.g. the Daraja call itself failed). */
export async function releaseStkLock(fingerprint: string): Promise<void> {
  try {
    await redis.del(k(keys.stkLock(fingerprint)));
  } catch {
    // TTL will expire it anyway
  }
}
