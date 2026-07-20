import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { env } from '@/lib/env';
import { drainEmailQueues } from '@/lib/services/email-queue-worker.service';

// OPTIMIZATION_CLEANUP_AUDIT.md Critical #3 — this check used to be
// conditional (`if (workerSecret) {...}`), meaning it was skipped entirely
// if WORKER_SECRET was ever unset, leaving this route unauthenticated. Now
// fail-closed and timing-safe, matching workers/cron's pattern exactly —
// WORKER_SECRET is a required (non-optional) var in lib/env.ts's schema, so
// it's already guaranteed present in any correctly-validated deployment.
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

// Manual/emergency trigger only — the real schedule is the
// `email_queue_drain` job (lib/jobs), which runs every 5 minutes via the
// confirmed-live Supabase pg_cron → POST /api/cron path (OPTIMIZATION_
// CLEANUP_AUDIT.md Medium #30). Kept for local dev and CI smoke tests.
export async function POST(req: NextRequest) {
  if (!isAuthorised(req)) {
    return NextResponse.json({ success: false, error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  }

  const { processed, failed } = await drainEmailQueues();
  return NextResponse.json({ success: true, processed, failed });
}
