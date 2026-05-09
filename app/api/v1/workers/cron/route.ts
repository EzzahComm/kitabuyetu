import { NextRequest, NextResponse } from 'next/server';
import { processDueSchedules, retryFailedEmails } from '@/lib/services/scheduler.service';
import { sendBirthdayEmails } from '@/lib/services/member-email.service';
import { sendOverdueInvoiceReminders, processRecurringInvoices } from '@/lib/services/billing-email.service';
import { sendWeeklySummaries } from '@/lib/services/report-email.service';

// Cron endpoint — call this from a cron job or Vercel Cron / cPanel cron
// Recommended schedule: every 5 minutes
// Authorization: Bearer $WORKER_SECRET
export async function POST(req: NextRequest) {
  const workerSecret = process.env.WORKER_SECRET;
  if (workerSecret) {
    const authHeader = req.headers.get('authorization') ?? '';
    if (authHeader !== `Bearer ${workerSecret}`) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const now   = new Date();
  const hour  = now.getUTCHours();
  const day   = now.getUTCDay(); // 0=Sun,1=Mon,...,6=Sat
  const date  = now.getUTCDate();

  const results: Record<string, unknown> = {};

  // Always: process scheduled emails and retry failures
  results.schedules = await processDueSchedules().catch((e: Error) => ({ error: e.message }));
  results.retries   = await retryFailedEmails().catch((e: Error) => ({ error: e.message }));

  // Daily at 07:00 UTC: birthday emails
  if (hour === 7) {
    results.birthdays = await sendBirthdayEmails()
      .then(() => 'done')
      .catch((e: Error) => ({ error: e.message }));
  }

  // Daily at 09:00 UTC: overdue invoice reminders
  if (hour === 9) {
    results.overdueInvoices = await sendOverdueInvoiceReminders()
      .then(() => 'done')
      .catch((e: Error) => ({ error: e.message }));
  }

  // Daily at 06:00 UTC: process recurring invoice generation
  if (hour === 6) {
    results.recurringInvoices = await processRecurringInvoices()
      .then(() => 'done')
      .catch((e: Error) => ({ error: e.message }));
  }

  // Monday at 08:00 UTC: weekly summaries
  if (day === 1 && hour === 8) {
    results.weeklySummaries = await sendWeeklySummaries()
      .then(() => 'done')
      .catch((e: Error) => ({ error: e.message }));
  }

  // 1st of month at 08:00 UTC: placeholder for monthly statement trigger
  if (date === 1 && hour === 8) {
    results.monthlyStatements = 'triggered_externally';
  }

  return NextResponse.json({ success: true, results, timestamp: now.toISOString() });
}
