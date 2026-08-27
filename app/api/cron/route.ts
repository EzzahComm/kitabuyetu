/**
 * POST /api/cron
 *
 * Called every 5 minutes by Supabase pg_cron via pg_net.http_post().
 * Also accepts manual triggers (same CRON_SECRET) for debugging.
 *
 * Security model:
 *   - Timing-safe CRON_SECRET validation (prevents brute-force + timing attacks)
 *   - POST only — no GET so the route can never be triggered by crawlers / prefetch
 *   - Returns generic error messages to avoid information leakage
 *
 * Architecture:
 *   Supabase pg_cron (every 5 min)
 *     → POST /api/cron   (this file)
 *       → enqueueTimeBasedJobs()   (adds jobs based on current UTC time)
 *       → processJobBatch()        (claims + executes up to 10 pending jobs)
 *         → exponential-backoff retry on failure
 */
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { enqueueTimeBasedJobs, processJobBatch } from '@/lib/jobs';
import { logger } from '@/lib/logger';

// Force Node.js runtime — pg driver requires it (not Edge-compatible)
export const runtime = 'nodejs';
// Disable Next.js static optimisation — every call must be fresh
export const dynamic = 'force-dynamic';
/**
 * Pinned, not inherited. processJobBatch enforces its own TIME_BUDGET_MS
 * (50s) and that budget is only safe if it is provably below the function's
 * real ceiling — a platform default can move underneath it, and if it ever
 * moved DOWN the batch would resume being killed mid-write, which is the
 * exact failure that once left jobs in 'processing' limbo for days.
 *
 * 60s leaves 10s of headroom over the batch budget, and cron fires every
 * 5 minutes, so even a full-length tick finishes with 250s to spare.
 */
export const maxDuration = 60;

/**
 * Constant-time secret comparison.
 * Hashes both sides before comparing so length differences don't leak via timing.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function isAuthorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // reject if not configured — fail closed

  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return false;

  return timingSafeEqual(authHeader.slice(7), secret);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const started = Date.now();

  try {
    // 1. Enqueue any time-based jobs due in this 5-minute tick
    const enqueued = await enqueueTimeBasedJobs();

    // 2. Process the next batch of pending jobs (claim + execute + update)
    const processed = await processJobBatch();

    return NextResponse.json({
      ok:        true,
      timestamp: new Date().toISOString(),
      duration:  `${Date.now() - started}ms`,
      enqueued,
      processed,
    });
  } catch (err) {
    // OPTIMIZATION_CLEANUP_AUDIT.md Medium #22 — this used to include the
    // raw error message in the response body, contradicting this file's own
    // header comment ("Returns generic error messages to avoid information
    // leakage"). The full error is still logged server-side.
    logger.error('[cron] Unhandled error:', err);
    return NextResponse.json(
      { error: 'Internal error', timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
