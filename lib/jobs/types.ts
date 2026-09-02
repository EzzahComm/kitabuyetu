export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type JobType =
  | 'email_campaign_process'   // Process due email schedules (every 5 min)
  | 'email_campaign_launch'    // Ad-hoc: launch one email campaign (enqueued on demand)
  | 'email_retry_failed'       // Retry transiently-failed emails (every 5 min)
  | 'email_send'               // Ad-hoc: send one templated email (replaces lib/queue's Redis email fan-out)
  | 'email_campaign_drain'     // Drain due email_campaign_recipients rows for in-flight campaigns (every 5 min)
  | 'email_birthday'           // Birthday emails (daily 07:00 UTC)
  | 'email_overdue_invoices'   // Overdue invoice reminders (daily 09:00 UTC)
  | 'email_recurring_invoices' // Process recurring invoices (daily 06:00 UTC)
  | 'email_weekly_summary'     // Member weekly summary (Monday 08:00 UTC)
  | 'email_member_statements'  // Per-member account statements, all active groups (1st of month, 10:00 UTC)
  | 'mpesa_reconcile'             // Reconcile stuck M-Pesa transactions (every 5 min)
  | 'mpesa_replay_callbacks'      // DLQ replay of unprocessed inbound callbacks (every 5 min)
  | 'mpesa_reconcile_charges'     // Backfill missing B2C charge rows + journals (daily 03:00 UTC)
  | 'mpesa_daily_report'          // Daily M-Pesa reconciliation email to officers (daily 20:00 UTC / 23:00 EAT)
  | 'mpesa_balance_snapshot'      // Trigger an Account Balance query for the sub-accounts (daily 05:00 UTC)
  | 'accounting_balance_drift'    // Audit accounts.balance vs journal_lines sums (daily 04:00 UTC)
  | 'gl_cash_reconciliation'      // Compare GL Cash total to the real Daraja M-Pesa balance (daily 05:30 UTC)
  | 'journal_lines_partition_maintenance' // Ensure journal_lines has monthly partitions 3 months ahead (1st of month, 09:00 UTC)
  | 'governance_compute_metrics'  // Populate governance_snapshots/health_scores/alerts for every active group (1st of month, 11:00 UTC)
  | 'cleanup_expired_tokens'      // Remove expired refresh tokens (daily 02:00 UTC)
  | 'notify_loan_due_alerts'      // Loan repayment due/overdue alerts (daily 06:00 UTC)
  | 'notify_contribution_reminders' // Missed-contribution nudge (1st of month, 08:00 UTC)
  | 'sms_birthday_reminders'      // Birthday SMS for opted-in groups (daily 07:00 UTC, alongside email_birthday)
  | 'outbox_dispatch'             // Drain the transactional event_outbox (every 5 min)
  | 'payment_orphan_monitor'      // Alert on completed payments stuck in allocation_status='received' (hourly)
  | 'disbursement_orphan_monitor' // Alert on B2C disbursements stuck 'dispatched' with no callback (hourly)
  | 'payment_requests_expire'     // Transition open payment_requests past expires_at to 'expired' (hourly, rule A6)
  | 'sms_bulk_send'               // Ad-hoc: bill + dispatch a bulk/campaign SMS send (enqueued on demand)
  | 'sms_retry_failed'            // Retry due rows in sms_failures (every 5 min)
  | 'sms_process_schedules'       // Fire due sms_schedules + scheduled campaigns (every 5 min)
  | 'sms_poll_dlr'                // Poll provider for delivery status of sent messages (every 5 min)
  | 'sms_trigger_fire'            // Ad-hoc: dispatch a delayed/retried trigger-rule execution
  | 'sms_low_balance_alert'       // Ad-hoc: warn officers that SMS credits ran out (in-app + email, never SMS)
  | 'sms_provider_health'         // Sample the provider's recent failure rate, alert staff on an outage (hourly)
  | 'sms_release_stale_reservations' // Recover SMS credit reservations orphaned by a crash (every 5 min)
  | 'sms_credit_reconciliation'   // Report SMS credit/ledger and campaign-counter drift (daily 02:00 EAT)
  | 'sms_message_retention'      // Redact SMS bodies past the retention window (daily 02:00 EAT)
  | 'sms_allowance_monthly_reset'  // Zero the bundled SMS allowance for every active-subscription group (1st of month, 01:00 UTC)
  | 'organization_sms_allowance_grant'; // Grant each org's bundled SMS allowance on its plan's monthly anniversary (daily)

export interface Job {
  id:           string;
  type:         JobType;
  payload:      Record<string, unknown>;
  status:       JobStatus;
  priority:     number;
  attempts:     number;
  max_attempts: number;
  run_at:       Date;
  last_error:   string | null;
  dedup_key:    string | null;
  created_at:   Date;
  updated_at:   Date;
}

export interface EnqueueOptions {
  /** Higher = processed first within the same 5-min tick. Default 0. */
  priority?:     number;
  /** ISO date or Date object — allows scheduling future jobs. Default now. */
  run_at?:       Date;
  /** Max retry attempts before the job is permanently failed. Default 5. */
  max_attempts?: number;
  /** Unique string that prevents duplicate jobs (partial index on non-terminal rows). */
  dedup_key?:    string;
}

export interface ProcessResult {
  processed: number;
  succeeded: number;
  failed:    number;
  retried:   number;
}
