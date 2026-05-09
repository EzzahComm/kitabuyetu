import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { env } from '@/lib/env';
import { processDueSchedules, retryFailedEmails } from '@/lib/services/scheduler.service';
import { sendBirthdayEmails } from '@/lib/services/member-email.service';
import { sendOverdueInvoiceReminders, processRecurringInvoices } from '@/lib/services/billing-email.service';
import { sendWeeklySummaries } from '@/lib/services/report-email.service';

/**
 * Timing-safe string equality. Both inputs are hashed first so the comparison
 * is always constant-time regardless of the length of the mismatch.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Verify the caller is authorised.
 * - GET  (Vercel Cron): checks Authorization: Bearer <CRON_SECRET>
 * - POST (manual):      checks Authorization: Bearer <WORKER_SECRET>
 */
function isAuthorised(req: NextRequest, secret: string): boolean {
  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return false;
  const provided = authHeader.slice(7);
  return timingSafeEqual(provided, secret);
}

async function runCron(): Promise<Record<string, unknown>> {
  const now    = new Date();
  const hour   = now.getUTCHours();
  const day    = now.getUTCDay();   // 0=Sun … 6=Sat
  const date   = now.getUTCDate();

  const results: Record<string, unknown> = {};

  // Always: process scheduled emails and retry transient failures
  results.schedules = await processDueSchedules().catch((e: Error) => ({ error: e.message }));
  results.retries   = await retryFailedEmails().catch((e: Error) => ({ error: e.message }));

  // Daily at 07:00 UTC
  if (hour === 7) {
    results.birthdays = await sendBirthdayEmails()
      .then(() => 'done')
      .catch((e: Error) => ({ error: e.message }));
  }

  // Daily at 09:00 UTC
  if (hour === 9) {
    results.overdueInvoices = await sendOverdueInvoiceReminders()
      .then(() => 'done')
      .catch((e: Error) => ({ error: e.message }));
  }

  // Daily at 06:00 UTC
  if (hour === 6) {
    results.recurringInvoices = await processRecurringInvoices()
      .then(() => 'done')
      .catch((e: Error) => ({ error: e.message }));
  }

  // Monday at 08:00 UTC
  if (day === 1 && hour === 8) {
    results.weeklySummaries = await sendWeeklySummaries()
      .then(() => 'done')
      .catch((e: Error) => ({ error: e.message }));
  }

  // 1st of month at 08:00 UTC
  if (date === 1 && hour === 8) {
    results.monthlyStatements = 'triggered_externally';
  }

  return results;
}

/**
 * GET /api/v1/workers/cron
 * Called by Vercel Cron on the schedule defined in vercel.json.
 * Vercel automatically adds Authorization: Bearer <CRON_SECRET>.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const cronSecret = env.CRON_SECRET;
  if (!cronSecret) {
    // If CRON_SECRET is not configured, reject to prevent unauthenticated execution.
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
  }

  if (!isAuthorised(req, cronSecret)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const results = await runCron();
  return NextResponse.json({ success: true, results, timestamp: new Date().toISOString() });
}

/**
 * POST /api/v1/workers/cron
 * Manual trigger — protected by WORKER_SECRET.
 * Use for: external schedulers, QStash, uptime monitors with auth headers.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // WORKER_SECRET is required (validated by lib/env.ts at startup).
  if (!isAuthorised(req, env.WORKER_SECRET)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const results = await runCron();
  return NextResponse.json({ success: true, results, timestamp: new Date().toISOString() });
}
