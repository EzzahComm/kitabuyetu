/**
 * Job handlers — one function per JobType.
 * Each handler must be:
 *   - Idempotent: safe to run more than once for the same logical event
 *   - Isolated: failures don't affect other jobs
 *   - Fast: Vercel Hobby functions time out at 10 s; keep handlers under 8 s
 */
import type { Job } from './types';
import { pool } from '@/lib/db';

export interface HandlerResult {
  message:  string;
  [key: string]: unknown;
}

/**
 * Route a job to its handler.
 * Throws on failure — the processor catches and handles retry/backoff.
 */
export async function handleJob(job: Job): Promise<HandlerResult> {
  switch (job.type) {
    case 'email_campaign_process':
      return handleEmailCampaignProcess();

    case 'email_retry_failed':
      return handleEmailRetryFailed();

    case 'email_birthday':
      return handleEmailBirthday();

    case 'email_overdue_invoices':
      return handleEmailOverdueInvoices();

    case 'email_recurring_invoices':
      return handleEmailRecurringInvoices();

    case 'email_weekly_summary':
      return handleEmailWeeklySummary();

    case 'mpesa_reconcile':
      return handleMpesaReconcile();

    case 'cleanup_expired_tokens':
      return handleCleanupExpiredTokens();

    default: {
      const exhaustiveCheck: never = job.type;
      throw new Error(`Unknown job type: ${exhaustiveCheck}`);
    }
  }
}

// ── Email handlers ────────────────────────────────────────────

async function handleEmailCampaignProcess(): Promise<HandlerResult> {
  const { processDueSchedules } = await import('@/lib/services/scheduler.service');
  const result = await processDueSchedules();
  return { message: 'Email campaigns processed', ...flattenResult(result) };
}

async function handleEmailRetryFailed(): Promise<HandlerResult> {
  const { retryFailedEmails } = await import('@/lib/services/scheduler.service');
  const result = await retryFailedEmails();
  return { message: 'Failed emails retried', ...flattenResult(result) };
}

async function handleEmailBirthday(): Promise<HandlerResult> {
  const { sendBirthdayEmails } = await import('@/lib/services/member-email.service');
  await sendBirthdayEmails();
  return { message: 'Birthday emails sent' };
}

async function handleEmailOverdueInvoices(): Promise<HandlerResult> {
  const { sendOverdueInvoiceReminders } = await import('@/lib/services/billing-email.service');
  await sendOverdueInvoiceReminders();
  return { message: 'Overdue invoice reminders sent' };
}

async function handleEmailRecurringInvoices(): Promise<HandlerResult> {
  const { processRecurringInvoices } = await import('@/lib/services/billing-email.service');
  await processRecurringInvoices();
  return { message: 'Recurring invoices processed' };
}

async function handleEmailWeeklySummary(): Promise<HandlerResult> {
  const { sendWeeklySummaries } = await import('@/lib/services/report-email.service');
  await sendWeeklySummaries();
  return { message: 'Weekly summaries sent' };
}

// ── M-Pesa handler ────────────────────────────────────────────

async function handleMpesaReconcile(): Promise<HandlerResult> {
  // Idempotency: runReconciliation checks transaction IDs before acting.
  // Pass null/null for a global (cross-group) reconciliation pass.
  const { runReconciliation } = await import('@/lib/services/mpesa.service');
  const result = await runReconciliation(null, null);
  return { message: 'M-Pesa reconciliation complete', ...flattenResult(result) };
}

// ── Cleanup handler ───────────────────────────────────────────

async function handleCleanupExpiredTokens(): Promise<HandlerResult> {
  const { rowCount } = await pool.query(
    `DELETE FROM refresh_tokens WHERE expires_at < NOW()`,
  );
  return { message: 'Expired refresh tokens removed', deleted: rowCount ?? 0 };
}

// ── Helpers ───────────────────────────────────────────────────

/**
 * Safely flatten a handler return value into a plain object.
 * Handles undefined, null, Error objects, and plain records.
 */
function flattenResult(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (value instanceof Error) return { error: value.message };
  if (typeof value === 'object') return value as Record<string, unknown>;
  return { result: value };
}
