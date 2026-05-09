import Redis from 'ioredis';

if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL environment variable is not set');
}

const PREFIX  = process.env.REDIS_PREFIX ?? 'ky:';

const globalWithRedis = globalThis as typeof globalThis & { _kyRedis?: Redis };

if (!globalWithRedis._kyRedis) {
  globalWithRedis._kyRedis = new Redis(process.env.REDIS_URL, {
    keyPrefix:         PREFIX,
    maxRetriesPerRequest: 3,
    enableOfflineQueue: false,
    lazyConnect:       false,
  });

  globalWithRedis._kyRedis.on('error', (err: Error) => {
    console.error('[redis] Connection error:', err.message);
  });
}

export const redis = globalWithRedis._kyRedis;

// ------------------------------------------------------------------
// Typed key namespaces — prevents key collisions across modules
// ------------------------------------------------------------------
export const keys = {
  refreshToken: (tokenHash: string) => `rt:${tokenHash}`,
  loginAttempts: (phone: string)    => `login_attempts:${phone}`,
  accountLock:  (phone: string)     => `account_lock:${phone}`,
  smsQueue:     (groupId: string)   => `sms_queue:${groupId}`,
  mpesaStatus:  (checkoutReqId: string) => `mpesa:${checkoutReqId}`,
  rateLimit:    (ip: string)        => `rl:${ip}`,
  sessionCache: (userId: string)    => `session:${userId}`,
};

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

/** Store a refresh token hash with an absolute TTL. */
export async function storeRefreshToken(
  tokenHash: string,
  userId: string,
  ttlSeconds: number,
): Promise<void> {
  await redis.set(keys.refreshToken(tokenHash), userId, 'EX', ttlSeconds);
}

/** Validate a refresh token hash exists and return the userId. */
export async function getRefreshToken(tokenHash: string): Promise<string | null> {
  return redis.get(keys.refreshToken(tokenHash));
}

/** Invalidate a refresh token. */
export async function revokeRefreshToken(tokenHash: string): Promise<void> {
  await redis.del(keys.refreshToken(tokenHash));
}

/** Track login attempt count. Returns current count after increment. */
export async function incrementLoginAttempts(phone: string): Promise<number> {
  const key = keys.loginAttempts(phone);
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, 60 * 60); // 1 hour window
  }
  return count;
}

export async function clearLoginAttempts(phone: string): Promise<void> {
  await redis.del(keys.loginAttempts(phone));
}

export async function getLoginAttempts(phone: string): Promise<number> {
  const val = await redis.get(keys.loginAttempts(phone));
  return val ? parseInt(val, 10) : 0;
}

export async function lockAccount(phone: string, minutes: number): Promise<void> {
  await redis.set(keys.accountLock(phone), '1', 'EX', minutes * 60);
}

export async function isAccountLocked(phone: string): Promise<boolean> {
  const val = await redis.get(keys.accountLock(phone));
  return val !== null;
}

/** Cache M-Pesa STK status so the frontend can poll cheaply. */
export async function cacheMpesaStatus(
  checkoutRequestId: string,
  status: 'pending' | 'completed' | 'failed',
  ttlSeconds = 300,
): Promise<void> {
  await redis.set(keys.mpesaStatus(checkoutRequestId), status, 'EX', ttlSeconds);
}

export async function getMpesaStatus(
  checkoutRequestId: string,
): Promise<'pending' | 'completed' | 'failed' | null> {
  const val = await redis.get(keys.mpesaStatus(checkoutRequestId));
  return val as 'pending' | 'completed' | 'failed' | null;
}
