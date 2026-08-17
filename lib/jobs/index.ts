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

  // Replaces the old lib/queue-based per-recipient campaign fan-out — claims a
  // batch of 'pending' email_campaign_recipients rows for in-flight
  // campaigns directly from Postgres (OPTIMIZATION_CLEANUP_AUDIT.md's
  // lib/queue + lib/jobs merge).
  queued.email_campaign_drain = await safe('email_campaign_drain', {}, {
    priority:  5,
    dedup_key: `email_campaign_drain:${dateStr}T${hour}:${fiveMinBucket}`,
  });

  queued.sms_retry_failed = await safe('sms_retry_failed', {}, {
    priority:  6, // SMS retries are time-sensitive (transactional receipts/OTPs)
    dedup_key: `sms_retry_failed:${dateStr}T${hour}:${fiveMinBucket}`,
  });

  queued.sms_process_schedules = await safe('sms_process_schedules', {}, {
    priority:  5,
    dedup_key: `sms_process_schedules:${dateStr}T${hour}:${fiveMinBucket}`,
  });

  queued.sms_poll_dlr = await safe('sms_poll_dlr', {}, {
    priority:  4,
    dedup_key: `sms_poll_dlr:${dateStr}T${hour}:${fiveMinBucket}`,
  });

  // Recovers SMS credit earmarks orphaned by a crash between the provider call
  // and the settle write. Low priority: correctness backstop, not time-critical.
  queued.sms_release_stale_reservations = await safe('sms_release_stale_reservations', {}, {
    priority:  3,
    dedup_key: `sms_release_stale_reservations:${dateStr}T${hour}:${fiveMinBucket}`,
  });

  queued.mpesa_reconcile = await safe('mpesa_reconcile', {}, {
    priority:  10, // highest — payments are time-sensitive
    dedup_key: `mpesa_reconcile:${dateStr}T${hour}:${fiveMinBucket}`,
  });

  // DLQ replay — re-runs inbound money callbacks whose effect didn't land.
  queued.mpesa_replay_callbacks = await safe('mpesa_replay_callbacks', {}, {
    priority:  9,
    dedup_key: `mpesa_replay_callbacks:${dateStr}T${hour}:${fiveMinBucket}`,
  });

  // Transactional outbox drain (payment architecture §12).
  queued.outbox_dispatch = await safe('outbox_dispatch', {}, {
    priority:  8,
    dedup_key: `outbox_dispatch:${dateStr}T${hour}:${fiveMinBucket}`,
  });

  // ── Hourly — payment-spine orphan monitor (§16) ────────────────
  if (fiveMinBucket === 0) {
    queued.payment_orphan_monitor = await safe('payment_orphan_monitor', {}, {
      priority:  7,
      dedup_key: `payment_orphan_monitor:${dateStr}T${hour}`,
    });

    // B2C disbursement stuck-payout monitor (B2C audit C5/F13).
    queued.disbursement_orphan_monitor = await safe('disbursement_orphan_monitor', {}, {
      priority:  9, // outbound money stuck unresolved — high priority
      dedup_key: `disbursement_orphan_monitor:${dateStr}T${hour}`,
    });

    // Payment-request expiry sweep (allocation rule A6). The allocation
    // engine's query also filters expired rows, so hourly cadence only
    // affects reporting freshness, never allocation correctness.
    queued.payment_requests_expire = await safe('payment_requests_expire', {}, {
      priority:  5,
      dedup_key: `payment_requests_expire:${dateStr}T${hour}`,
    });
  }

  // ── Daily 06:00 UTC — recurring invoices ──────────────────────
  if (hour === 6) {
    queued.email_recurring_invoices = await safe('email_recurring_invoices', {}, {
      priority:  4,
      dedup_key: `email_recurring_invoices:${dateStr}`,
    });
  }

  // ── Daily 07:00 UTC — birthday emails + birthday SMS ──────────
  // SMS is a separate job type (billed, per-group opt-in via
  // sms_group_settings.auto_send_birthday, defaults false) rather than
  // folded into email_birthday — the two channels have independent
  // opt-in/consent/cost models and reminder_dispatch_log deduplicates
  // per-channel via reference_type already, so nothing forces them
  // through one job. sms_schedules.schedule_type had a 'birthday' value
  // sitting unprocessed for this (sms-scheduler.service.ts's own header
  // comment: "left for a dedicated follow-up") — this is that follow-up,
  // built as a global job like notify_loan_due_alerts rather than a
  // per-group schedule row, since "who gets messaged" varies by the day
  // (today's birthdays), not a fixed recipient list on a fixed cadence.
  if (hour === 7) {
    queued.email_birthday = await safe('email_birthday', {}, {
      priority:  3,
      dedup_key: `email_birthday:${dateStr}`,
    });
    queued.sms_birthday_reminders = await safe('sms_birthday_reminders', {}, {
      priority:  6,
      dedup_key: `sms_birthday_reminders:${dateStr}`,
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

  // ── Daily 03:00 UTC (06:00 EAT) — M-Pesa charge backfill ──────
  // Catches B2C transactions that completed without an mpesa_charges row.
  if (hour === 3) {
    queued.mpesa_reconcile_charges = await safe('mpesa_reconcile_charges', {}, {
      priority:  4,
      dedup_key: `mpesa_reconcile_charges:${dateStr}`,
    });
  }

  // ── Daily 04:00 UTC (07:00 EAT) — accounts.balance drift audit ─
  // Compares the denormalized balance column against journal_lines sums
  // and records any drift for finance review (detection only, no rewrite).
  if (hour === 4) {
    queued.accounting_balance_drift = await safe('accounting_balance_drift', {}, {
      priority:  4,
      dedup_key: `accounting_balance_drift:${dateStr}`,
    });
  }

  // ── Daily 05:00 UTC (08:00 EAT) — sub-account balance snapshot ─
  if (hour === 5) {
    queued.mpesa_balance_snapshot = await safe('mpesa_balance_snapshot', {}, {
      priority:  3,
      dedup_key: `mpesa_balance_snapshot:${dateStr}`,
    });
  }

  // ── Daily 06:00 UTC (09:00 EAT) — GL-to-real-cash reconciliation ─
  // One hour after the balance snapshot trigger above, so its async Daraja
  // result has had time to land (ACCOUNTING_ARCHITECTURE_AUDIT.md §16).
  if (hour === 6) {
    queued.gl_cash_reconciliation = await safe('gl_cash_reconciliation', {}, {
      priority:  4,
      dedup_key: `gl_cash_reconciliation:${dateStr}`,
    });
  }

  // ── Daily 20:00 UTC (23:00 EAT) — M-Pesa daily report email ───
  if (hour === 20) {
    queued.mpesa_daily_report = await safe('mpesa_daily_report', {}, {
      priority:  3,
      dedup_key: `mpesa_daily_report:${dateStr}`,
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

  // ── DAILY 01:00 UTC — SMS bundled-allowance reset ────────────────────
  // Was `date === 1` with a YYYY-MM dedup key: one sweep a month, resetting
  // every group together. Migration 151 moved the allowance period onto each
  // group's own subscription anniversary, and anniversaries fall on every day
  // of the month, so this has to run daily and the dedup key has to be per
  // DAY rather than per month — a monthly key would let the first run of a
  // month suppress the other thirty.
  //
  // Resetting nothing is the normal case and costs one indexed UPDATE.
  // resetDueSmsAllowances() is idempotent (it compares the derived anniversary
  // against sms_allowance_period_start), so a double tick cannot hand out two
  // allowances.
  //
  // Still runs well before the 08:00 contribution-reminder sweep below, so
  // that day's first billed sends see a freshly-reset allowance rather than
  // the previous period's. Hour 1 remains otherwise unused across this file
  // (docs/messaging/UNIFIED_MESSAGING_ARCHITECTURE.md Phase 2b).
  if (hour === 1) {
    queued.sms_allowance_monthly_reset = await safe('sms_allowance_monthly_reset', {}, {
      priority:  4,
      dedup_key: `sms_allowance_monthly_reset:${dateStr}`,
    });
    // Organization-side sibling, same hour and same daily-not-monthly
    // reasoning (migration 152) — a separate job rather than folded into the
    // one above, since it grants against a different table pair
    // (organization_subscriptions/organization_billing_accounts) entirely.
    queued.organization_sms_allowance_grant = await safe('organization_sms_allowance_grant', {}, {
      priority:  4,
      dedup_key: `organization_sms_allowance_grant:${dateStr}`,
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

  // ── 1st of month 09:00 UTC — journal_lines partition maintenance ──
  // Ensures monthly partitions exist 3 months ahead (ACCOUNTING_ARCHITECTURE_
  // AUDIT.md §17/§19, migrations 094/095). A distinct hour from the 08:00
  // and 10:00 buckets so nothing competes within the same tick.
  if (date === 1 && hour === 9) {
    const monthStr = dateStr.slice(0, 7); // YYYY-MM
    queued.journal_lines_partition_maintenance = await safe('journal_lines_partition_maintenance', {}, {
      priority:  4,
      dedup_key: `journal_lines_partition_maintenance:${monthStr}`,
    });
  }

  // ── 1st of month 10:00 UTC — per-member account statements ───
  // A distinct hour from the 08:00 bucket above so this and the
  // contribution-reminder sweep don't compete within the same tick.
  if (date === 1 && hour === 10) {
    const monthStr = dateStr.slice(0, 7); // YYYY-MM
    queued.email_member_statements = await safe('email_member_statements', {}, {
      priority:  2,
      dedup_key: `email_member_statements:${monthStr}`,
    });
  }

  // ── 1st of month 11:00 UTC — governance/health-score computation ─────
  // SUPER_ADMIN_PLATFORM_AUDIT.md §2.10 Phase 2. Hour 11 is otherwise
  // unused across this file, so this never competes with an existing
  // monthly/daily bucket within the same tick.
  if (date === 1 && hour === 11) {
    const monthStr = dateStr.slice(0, 7); // YYYY-MM
    queued.governance_compute_metrics = await safe('governance_compute_metrics', {}, {
      priority:  4,
      dedup_key: `governance_compute_metrics:${monthStr}`,
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
