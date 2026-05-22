/**
 * GET /api/health/deep — Connectivity probe for DB + Redis.
 *
 * Protected by WORKER_SECRET (same as cron) so it is not publicly queryable.
 * Used by staging pipelines and on-call runbooks to verify dependencies.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { redis } from '@/lib/redis';

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
  const secret = req.headers.get('x-worker-secret') ?? req.nextUrl.searchParams.get('secret');
  if (secret !== process.env.WORKER_SECRET) {
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
