/**
 * GET /api/health/deep — Connectivity probe for DB + Redis.
 *
 * Protected by WORKER_SECRET (same as cron) so it is not publicly queryable.
 * Used by staging pipelines and on-call runbooks to verify dependencies.
 *
 * Header only, timing-safe compare (OPTIMIZATION_CLEANUP_AUDIT.md High #15)
 * — this used to also accept the secret via a `?secret=` query string
 * (which can leak into access logs/referrers) and compared it with a plain
 * `!==`, unlike every other secret check in this codebase.
 */
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { pool } from '@/lib/db';
import { redis } from '@/lib/redis';
import { env } from '@/lib/env';

function timingSafeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CheckResult = { ok: boolean; latencyMs: number; error?: string };

async function checkDb(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
  }
}

async function checkRedis(): Promise<CheckResult> {
  const start = Date.now();
  try {
    await redis.ping();
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = req.headers.get('x-worker-secret') ?? '';
  if (!timingSafeEqual(secret, env.WORKER_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [db, redisResult] = await Promise.all([checkDb(), checkRedis()]);
  const allOk = db.ok && redisResult.ok;

  return NextResponse.json(
    {
      status:    allOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      checks: { database: db, redis: redisResult },
    },
    {
      status:  allOk ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
