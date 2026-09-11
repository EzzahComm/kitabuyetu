/**
 * Idempotency-Key support for money-moving POSTs (payment architecture §13).
 *
 * A client sends `Idempotency-Key: <uuid>`; the first execution's response is
 * stored for 24h, and any replay with the same key returns the ORIGINAL
 * response without re-executing — a retried request can never fire a second
 * STK prompt or double-record a transaction.
 *
 * Semantics:
 *  - Keys are scoped per user + route, so two users (or two endpoints) can't
 *    collide on the same UUID.
 *  - 5xx responses are NOT stored — server errors are retryable by contract.
 *  - No header → passthrough (Phase 2 makes the header mandatory on money
 *    POSTs; rolling it out permissively first avoids breaking older clients).
 *  - Redis loss fails OPEN (execute normally): the domain layer's own
 *    idempotency (receipt uniqueness, duplicate-prompt lock) remains the
 *    financial backstop; this layer is API-contract sugar on top.
 */
import { NextRequest } from 'next/server';
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';

const TTL_SECONDS = 24 * 60 * 60;
const PREFIX      = process.env.REDIS_PREFIX ?? 'ky:';

interface StoredResponse {
  status: number;
  body:   string;
}

export async function withIdempotencyKey(
  req:     NextRequest,
  userId:  string,
  route:   string,
  execute: () => Promise<Response>,
): Promise<Response> {
  const key = req.headers.get('idempotency-key');
  if (!key || key.length > 128) return execute();

  const redisKey = `${PREFIX}idem:${route}:${userId}:${key}`;

  try {
    const cached = await redis.get(redisKey);
    if (cached) {
      const stored = (typeof cached === 'string' ? JSON.parse(cached) : cached) as StoredResponse;
      return new Response(stored.body, {
        status:  stored.status,
        headers: { 'Content-Type': 'application/json', 'Idempotent-Replay': 'true' },
      });
    }
  } catch (err) {
    logger.warn('[idempotency] lookup failed — executing normally', { err: String(err) });
    return execute();
  }

  const response = await execute();

  // Server errors stay retryable; everything else is the contract-final answer.
  if (response.status < 500) {
    try {
      const body = await response.clone().text();
      await redis.set(redisKey, JSON.stringify({ status: response.status, body }), { ex: TTL_SECONDS });
    } catch (err) {
      logger.warn('[idempotency] store failed (non-fatal)', { err: String(err) });
    }
  }

  return response;
}
