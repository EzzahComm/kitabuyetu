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
