/**
 * POST /api/v1/workers/cron — Manual trigger (authenticated by WORKER_SECRET)
 *
 * Use this endpoint for:
 *   - Local development testing
 *   - CI/CD smoke tests
 *   - Emergency manual runs
 *
 * The primary scheduler is Supabase pg_cron → POST /api/cron.
 * This route is intentionally kept separate so WORKER_SECRET stays
 * independent of CRON_SECRET (principle of least privilege).
 */
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { env } from '@/lib/env';
import { enqueueTimeBasedJobs, processJobBatch } from '@/lib/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function timingSafeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function isAuthorised(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return false;
  return timingSafeEqual(authHeader.slice(7), env.WORKER_SECRET);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorised(req)) {
    return NextResponse.json(
      { success: false, error: 'Forbidden', code: 'FORBIDDEN' },
      { status: 403 },
    );
  }

  const started = Date.now();

  try {
    const enqueued  = await enqueueTimeBasedJobs();
    const processed = await processJobBatch();

    return NextResponse.json({
      success:   true,
      trigger:   'manual',
      timestamp: new Date().toISOString(),
      duration:  `${Date.now() - started}ms`,
      enqueued,
      processed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[workers/cron] Error:', err);
    return NextResponse.json(
      { success: false, error: message, timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
