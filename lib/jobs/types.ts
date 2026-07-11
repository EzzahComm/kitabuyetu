export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type JobType =
  | 'email_campaign_process'   // Process due email campaigns (every 5 min)
  | 'email_retry_failed'       // Retry transiently-failed emails (every 5 min)
  | 'email_birthday'           // Birthday emails (daily 07:00 UTC)
  | 'email_overdue_invoices'   // Overdue invoice reminders (daily 09:00 UTC)
  | 'email_recurring_invoices' // Process recurring invoices (daily 06:00 UTC)
  | 'email_weekly_summary'     // Member weekly summary (Monday 08:00 UTC)
  | 'mpesa_reconcile'             // Reconcile stuck M-Pesa transactions (every 5 min)
  | 'mpesa_replay_callbacks'      // DLQ replay of unprocessed inbound callbacks (every 5 min)
  | 'mpesa_reconcile_charges'     // Backfill missing B2C charge rows + journals (daily 03:00 UTC)
  | 'mpesa_daily_report'          // Daily M-Pesa reconciliation email to officers (daily 20:00 UTC / 23:00 EAT)
  | 'mpesa_balance_snapshot'      // Trigger an Account Balance query for the sub-accounts (daily 05:00 UTC)
  | 'cleanup_expired_tokens'      // Remove expired refresh tokens (daily 02:00 UTC)
  | 'notify_loan_due_alerts'      // Loan repayment due/overdue alerts (daily 06:00 UTC)
  | 'notify_contribution_reminders' // Missed-contribution nudge (1st of month, 08:00 UTC)
  | 'sms_bulk_send'               // Ad-hoc: bill + dispatch a bulk/campaign SMS send (enqueued on demand)
  | 'sms_retry_failed'            // Retry due rows in sms_failures (every 5 min)
  | 'sms_process_schedules'       // Fire due sms_schedules + scheduled campaigns (every 5 min)
  | 'sms_poll_dlr'                // Poll provider for delivery status of sent messages (every 5 min)
  | 'sms_trigger_fire';           // Ad-hoc: dispatch a delayed/retried trigger-rule execution

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
