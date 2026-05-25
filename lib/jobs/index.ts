/**
 * Public API for the Kitabu Yetu job queue.
 *
 * Usage:
 *   import { enqueueJob, processJobBatch, enqueueTimeBasedJobs } from '@/lib/jobs';
 */
export { processJobBatch }        from './processor';
export { insertJob as enqueueJob, pruneOldJobs } from './db';
export type { Job, JobType, JobStatus, EnqueueOptions, ProcessResult } from './types';

import { insertJob } from './db';
import type { JobType } from './types';

/**
 * Inspect the current UTC time and enqueue whichever time-based jobs
 * are due to run in this 5-minute tick.
 *
 * Dedup keys are scoped to the smallest relevant time unit so the same
 * job is never queued twice within its scheduling window:
 *   - Every-5-min jobs:  "{type}:{YYYY-MM-DD}T{HH}:{mm/5}"
 *   - Hourly jobs:       "{type}:{YYYY-MM-DD}T{HH}"
 *   - Daily jobs:        "{type}:{YYYY-MM-DD}"
 *   - Weekly jobs:       "{type}:{YYYY-WNN}"
 *
 * Returns a map of job_type → job_id (null means skipped/duplicate).
 */
export async function enqueueTimeBasedJobs(): Promise<Record<string, string | null>> {
  const now    = new Date();
  const hour   = now.getUTCHours();
  const day    = now.getUTCDay();   // 0 = Sun … 6 = Sat
  const date   = now.getUTCDate();
  const dateStr = toDateStr(now);   // YYYY-MM-DD
  const weekStr = toWeekStr(now);   // YYYY-WNN

  // 5-minute bucket index (0–11 per hour)
  const fiveMinBucket = Math.floor(now.getUTCMinutes() / 5);

  const queued: Record<string, string | null> = {};

  // ── Every 5 minutes ────────────────────────────────────────────
  queued.email_campaign_process = await safe('email_campaign_process', {}, {
    priority:  5,
    dedup_key: `email_campaign_process:${dateStr}T${hour}:${fiveMinBucket}`,
  });

  queued.email_retry_failed = await safe('email_retry_failed', {}, {
    priority:  5,
    dedup_key: `email_retry_failed:${dateStr}T${hour}:${fiveMinBucket}`,
  });

  queued.mpesa_reconcile = await safe('mpesa_reconcile', {}, {
    priority:  10, // highest — payments are time-sensitive
    dedup_key: `mpesa_reconcile:${dateStr}T${hour}:${fiveMinBucket}`,
  });

  // ── Daily 06:00 UTC — recurring invoices ──────────────────────
  if (hour === 6) {
    queued.email_recurring_invoices = await safe('email_recurring_invoices', {}, {
      priority:  4,
      dedup_key: `email_recurring_invoices:${dateStr}`,
    });
  }

  // ── Daily 07:00 UTC — birthday emails ─────────────────────────
  if (hour === 7) {
    queued.email_birthday = await safe('email_birthday', {}, {
      priority:  3,
      dedup_key: `email_birthday:${dateStr}`,
    });
  }

  // ── Daily 09:00 UTC — overdue invoice reminders ───────────────
  if (hour === 9) {
    queued.email_overdue_invoices = await safe('email_overdue_invoices', {}, {
      priority:  4,
      dedup_key: `email_overdue_invoices:${dateStr}`,
    });
  }

  // ── Monday 08:00 UTC — weekly summaries ───────────────────────
  if (day === 1 && hour === 8) {
    queued.email_weekly_summary = await safe('email_weekly_summary', {}, {
      priority:  2,
      dedup_key: `email_weekly_summary:${weekStr}`,
    });
  }

  // ── Daily 02:00 UTC — cleanup expired tokens ──────────────────
  if (hour === 2) {
    queued.cleanup_expired_tokens = await safe('cleanup_expired_tokens', {}, {
      priority:  1,
      dedup_key: `cleanup_expired_tokens:${dateStr}`,
    });
  }

  // ── Daily 06:00 UTC (09:00 EAT) — loan-due alerts ─────────────
  // Members in Kenya are most likely to act on a reminder mid-morning;
  // 09:00 EAT lands their notification just before they head to work.
  if (hour === 6) {
    queued.notify_loan_due_alerts = await safe('notify_loan_due_alerts', {}, {
      priority:  6,
      dedup_key: `notify_loan_due_alerts:${dateStr}`,
    });
  }

  // ── 1st of month 08:00 UTC — prune old jobs ───────────────────
  if (date === 1 && hour === 8) {
    const { pruneOldJobs } = await import('./db');
    await pruneOldJobs(30).catch(() => {}); // fire and forget

    // ── 1st of month 08:00 UTC (11:00 EAT) — contribution-reminders ──
    // Nudge members who didn't contribute in the previous calendar
    // month. Dedup keyed at month granularity so even repeated
    // 5-min ticks within the same hour won't re-enqueue.
    const monthStr = dateStr.slice(0, 7); // YYYY-MM
    queued.notify_contribution_reminders = await safe('notify_contribution_reminders', {}, {
      priority:  5,
      dedup_key: `notify_contribution_reminders:${monthStr}`,
    });
  }

  return queued;
}

/** Silently ignore duplicate-key conflicts instead of throwing. */
async function safe(
  type:    JobType,
  payload: Record<string, unknown>,
  opts?:   Parameters<typeof insertJob>[2],
): Promise<string | null> {
  return insertJob(type, payload, opts).catch(() => null);
}

// ── Date helpers ──────────────────────────────────────────────

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function toWeekStr(d: Date): string {
  // ISO 8601 week number
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayOfWeek = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayOfWeek);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo    = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}
