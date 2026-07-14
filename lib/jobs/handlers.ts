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

    case 'mpesa_replay_callbacks':
      return handleMpesaReplayCallbacks();

    case 'mpesa_reconcile_charges':
      return handleMpesaReconcileCharges();

    case 'mpesa_daily_report':
      return handleMpesaDailyReport();

    case 'mpesa_balance_snapshot':
      return handleMpesaBalanceSnapshot();

    case 'outbox_dispatch':
      return handleOutboxDispatch();

    case 'payment_orphan_monitor':
      return handlePaymentOrphanMonitor();

    case 'accounting_balance_drift':
      return handleAccountingBalanceDrift();

    case 'cleanup_expired_tokens':
      return handleCleanupExpiredTokens();

    case 'notify_loan_due_alerts':
      return handleLoanDueAlerts();

    case 'notify_contribution_reminders':
      return handleContributionReminders();

    case 'sms_bulk_send':
      return handleSmsBulkSend(job.payload);

    case 'sms_retry_failed':
      return handleSmsRetryFailed();

    case 'sms_process_schedules':
      return handleSmsProcessSchedules();

    case 'sms_poll_dlr':
      return handleSmsPollDlr();

    case 'sms_trigger_fire':
      return handleSmsTriggerFire(job.payload);

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

async function handleMpesaReplayCallbacks(): Promise<HandlerResult> {
  const { replayUnprocessedCallbacks } = await import('@/lib/services/mpesa.service');
  const result = await replayUnprocessedCallbacks();
  return { message: 'M-Pesa callback DLQ replay complete', ...flattenResult(result) };
}

async function handleMpesaReconcileCharges(): Promise<HandlerResult> {
  const { reconcileCharges } = await import('@/lib/services/mpesa.service');
  const result = await reconcileCharges();
  return { message: 'M-Pesa charge backfill complete', ...flattenResult(result) };
}

async function handleMpesaDailyReport(): Promise<HandlerResult> {
  const { sendDailyMpesaReconReports } = await import('@/lib/services/mpesa-reports.service');
  const result = await sendDailyMpesaReconReports();
  return { message: 'M-Pesa daily report sent', ...flattenResult(result) };
}

async function handleMpesaBalanceSnapshot(): Promise<HandlerResult> {
  // One Account Balance query returns every sub-account balance via the async
  // callback (handleBalanceResult persists it). Fired once daily per group that
  // has officers; here we trigger a single org-level query.
  const { queryAccountBalance } = await import('@/lib/services/daraja.service');
  await queryAccountBalance();
  return { message: 'M-Pesa balance snapshot requested' };
}

async function handleOutboxDispatch(): Promise<HandlerResult> {
  const { dispatchOutboxEvents } = await import('@/lib/services/outbox.service');
  const result = await dispatchOutboxEvents();
  return { message: 'Outbox dispatched', ...flattenResult(result) };
}

async function handlePaymentOrphanMonitor(): Promise<HandlerResult> {
  const { findSpineOrphans } = await import('@/lib/services/outbox.service');
  const result = await findSpineOrphans();
  return {
    message: result.count === 0
      ? 'Payment spine: no orphans'
      : `Payment spine: ${result.count} ORPHANED payment(s) — investigate`,
    orphans: result.count,
  };
}

async function handleAccountingBalanceDrift(): Promise<HandlerResult> {
  const { detectBalanceDrift } = await import('@/lib/services/accounting.service');
  const result = await detectBalanceDrift();
  return { message: 'Balance drift audit complete', ...result };
}

// ── Cleanup handler ───────────────────────────────────────────

async function handleCleanupExpiredTokens(): Promise<HandlerResult> {
  const { rowCount } = await pool.query(
    `DELETE FROM refresh_tokens WHERE expires_at < NOW()`,
  );
  return { message: 'Expired refresh tokens removed', deleted: rowCount ?? 0 };
}

// ── Notification handlers (E10.2) ─────────────────────────────

async function handleLoanDueAlerts(): Promise<HandlerResult> {
  const { renderBuiltin, TEMPLATE_KEYS } = await import('@/lib/sms/templates');
  const { notifyMany } = await import('@/lib/services/notifications.service');

  // Pending installments due within the next 3 days OR already overdue.
  // Limit cap protects the cron from running long on a backlog — a daily
  // cadence means the next tick picks up anything left.
  const { rows } = await pool.query<{
    repayment_id:    string;
    group_id:        string;
    member_id:       string;
    phone:           string;
    first_name:      string;
    total_due:       string;
    closing_balance: string;
    due_date:        string;
    penalty_amount:  string;
    overdue:         boolean;
  }>(
    `SELECT lr.id           AS repayment_id,
            lr.group_id,
            lr.member_id,
            m.phone,
            m.first_name,
            lr.total_due,
            lr.closing_balance,
            to_char(lr.due_date, 'DD Mon YYYY') AS due_date,
            lr.penalty_amount,
            (lr.due_date < CURRENT_DATE)        AS overdue
       FROM loan_repayments lr
       JOIN loans   l  ON l.id   = lr.loan_id
       JOIN members m  ON m.id   = lr.member_id
       JOIN groups  g  ON g.id   = lr.group_id
       JOIN group_members gm
         ON gm.group_id = lr.group_id AND gm.member_id = lr.member_id
      WHERE lr.status = 'pending'
        AND g.status  = 'active'
        AND gm.status = 'active'
        AND m.phone IS NOT NULL AND m.phone <> ''
        AND (
          lr.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '3 days'
          OR lr.due_date < CURRENT_DATE
        )
      ORDER BY lr.due_date ASC
      LIMIT 500`,
  );

  if (rows.length === 0) {
    return { message: 'Loan-due alerts: no candidates', attempted: 0, sent: 0 };
  }

  const recipients = rows.map((r) => {
    const body = r.overdue
      ? renderBuiltin(TEMPLATE_KEYS.LOAN_OVERDUE, {
          first_name:     r.first_name,
          amount:         r.total_due,
          penalty_amount: r.penalty_amount,
        })
      : renderBuiltin(TEMPLATE_KEYS.LOAN_REPAYMENT_DUE, {
          first_name: r.first_name,
          amount:     r.total_due,
          due_date:   r.due_date,
          balance:    r.closing_balance,
        });
    return {
      groupId:       r.group_id,
      memberId:      r.member_id,
      phone:         r.phone,
      body,
      referenceType: 'loan_repayment',
      referenceId:   r.repayment_id,
    };
  });

  const tally = await notifyMany(recipients);
  return {
    message:  `Loan-due alerts processed (${rows.length} candidates)`,
    ...tally,
  };
}

async function handleContributionReminders(): Promise<HandlerResult> {
  const { renderTemplate } = await import('@/lib/sms/templates');
  const { notifyMany } = await import('@/lib/services/notifications.service');

  // Active members of active groups who recorded NO completed contribution
  // in the previous calendar month. NOT EXISTS keeps the planner using
  // idx_contributions_member_id (member_id, status, contribution_date is
  // already covered well enough at our cardinality).
  const { rows } = await pool.query<{
    group_id:   string;
    member_id:  string;
    phone:      string;
    first_name: string;
    group_name: string;
    last_month: string;
  }>(
    `SELECT gm.group_id,
            gm.member_id,
            m.phone,
            m.first_name,
            g.name AS group_name,
            to_char(date_trunc('month', CURRENT_DATE) - INTERVAL '1 month', 'Mon YYYY') AS last_month
       FROM group_members gm
       JOIN members m ON m.id = gm.member_id
       JOIN groups  g ON g.id = gm.group_id
      WHERE gm.status = 'active'
        AND g.status  = 'active'
        AND m.phone IS NOT NULL AND m.phone <> ''
        AND NOT EXISTS (
          SELECT 1 FROM contributions c
           WHERE c.group_id  = gm.group_id
             AND c.member_id = gm.member_id
             AND c.status    = 'completed'
             AND c.contribution_date >= date_trunc('month', CURRENT_DATE) - INTERVAL '1 month'
             AND c.contribution_date <  date_trunc('month', CURRENT_DATE)
        )
      ORDER BY gm.group_id, gm.member_id
      LIMIT 1000`,
  );

  if (rows.length === 0) {
    return { message: 'Contribution reminders: no candidates', attempted: 0, sent: 0 };
  }

  const template =
    'Dear {{first_name}}, our records show no contribution for {{group_name}} in {{last_month}}. ' +
    'Kindly contribute when you can. Thank you.';

  const recipients = rows.map((r) => ({
    groupId:       r.group_id,
    memberId:      r.member_id,
    phone:         r.phone,
    body:          renderTemplate(template, {
      first_name: r.first_name,
      group_name: r.group_name,
      last_month: r.last_month,
    }),
    referenceType: 'contribution_reminder',
    referenceId:   undefined,
  }));

  const tally = await notifyMany(recipients);
  return {
    message: `Contribution reminders processed (${rows.length} candidates)`,
    ...tally,
  };
}

// ── SMS dispatch handler ──────────────────────────────────────

/**
 * Durable bulk/campaign SMS dispatch. Enqueued by /sms/bulk and /sms/campaign
 * so the provider calls survive serverless instance termination (the old
 * setImmediate path silently dropped them). Billing + opt-out + log creation
 * + provider dispatch all happen here, inside the retry-managed job.
 *
 * NOTE: a very large campaign still runs in a single job invocation. If that
 * invocation times out it is reset to pending and re-run, which can re-bill and
 * re-send (no per-recipient checkpoint yet) — chunking + idempotency is tracked
 * as SMS-015/SMS-007. For current group sizes a single job is well within the
 * function budget.
 */
async function handleSmsBulkSend(payload: Record<string, unknown>): Promise<HandlerResult> {
  const { smsService } = await import('@/lib/services/sms.service');
  const phones = Array.isArray(payload.phones) ? (payload.phones as string[]) : [];
  if (!payload.groupId || phones.length === 0) {
    return { message: 'SMS bulk send skipped: no recipients', sent: 0, failed: 0 };
  }

  // An organization-funded campaign carries its payer through the queue, so a
  // job retried after a restart still bills the organization, not the group.
  const payer = payload.fundedBy === 'organization' && payload.payerOrganizationId
    ? { type: 'organization' as const, organizationId: String(payload.payerOrganizationId) }
    : undefined;

  const result = await smsService.sendBulkCampaign({
    campaignId:    payload.campaignId    ? String(payload.campaignId)    : undefined,
    phones,
    message:       String(payload.message ?? ''),
    senderId:      payload.senderId      ? String(payload.senderId)      : undefined,
    timeToSend:    payload.timeToSend    ? String(payload.timeToSend)    : undefined,
    groupId:       String(payload.groupId),
    sentBy:        String(payload.sentBy ?? ''),
    referenceType: payload.referenceType ? String(payload.referenceType) : undefined,
    referenceId:   payload.referenceId   ? String(payload.referenceId)   : undefined,
    payer,
  });

  return { message: `SMS bulk send dispatched (${result.sent} sent, ${result.failed} failed)`, ...flattenResult(result) };
}

async function handleSmsRetryFailed(): Promise<HandlerResult> {
  const { smsService } = await import('@/lib/services/sms.service');
  const result = await smsService.retryFailures();
  return { message: `SMS failures retried (${result.resolved} resolved, ${result.failed} still failing)`, ...flattenResult(result) };
}

async function handleSmsProcessSchedules(): Promise<HandlerResult> {
  const { processDueSmsSchedules, processDueScheduledCampaigns } = await import('@/lib/services/sms-scheduler.service');
  const schedules = await processDueSmsSchedules();
  const campaigns = await processDueScheduledCampaigns();
  return {
    message:          `SMS schedules processed (${schedules.processed} schedules, ${campaigns.processed} campaigns)`,
    schedules:        schedules.processed,
    schedulesSkipped: schedules.skipped,
    campaigns:        campaigns.processed,
  };
}

async function handleSmsPollDlr(): Promise<HandlerResult> {
  const { smsService } = await import('@/lib/services/sms.service');
  const result = await smsService.pollPendingDlrs();
  return {
    message: `DLR poll (${result.delivered} delivered, ${result.failed} failed, ${result.pending} pending of ${result.checked})`,
    ...flattenResult(result),
  };
}

/**
 * Dispatch one trigger-rule execution that was deferred (delay_seconds > 0) or
 * re-queued after a transient failure. dispatchExecution() is a no-op once the
 * execution row leaves 'pending', so a duplicated job cannot double-send.
 */
async function handleSmsTriggerFire(payload: Record<string, unknown>): Promise<HandlerResult> {
  const executionId = payload.executionId ? String(payload.executionId) : '';
  if (!executionId) return { message: 'SMS trigger fire skipped: no executionId' };

  const { dispatchExecution } = await import('@/lib/sms/trigger-engine');
  await dispatchExecution(executionId);
  return { message: `SMS trigger execution ${executionId} dispatched`, executionId };
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
