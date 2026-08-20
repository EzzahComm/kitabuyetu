/**
 * Job handlers — one function per JobType.
 * Each handler must be:
 *   - Idempotent: safe to run more than once for the same logical event
 *   - Isolated: failures don't affect other jobs
 *   - Fast: Vercel Hobby functions time out at 10 s; keep handlers under 8 s
 */
import type { Job } from './types';
import { pool } from '@/lib/db';
import { normalizePhone } from '@/lib/utils/phone';

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

    case 'email_campaign_launch':
      return handleEmailCampaignLaunch(job.payload);

    case 'email_retry_failed':
      return handleEmailRetryFailed();

    case 'email_send':
      return handleEmailSend(job.payload);

    case 'email_campaign_drain':
      return handleEmailCampaignDrain();

    case 'email_birthday':
      return handleEmailBirthday();

    case 'email_overdue_invoices':
      return handleEmailOverdueInvoices();

    case 'email_recurring_invoices':
      return handleEmailRecurringInvoices();

    case 'email_weekly_summary':
      return handleEmailWeeklySummary();

    case 'email_member_statements':
      return handleEmailMemberStatements();

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

    case 'disbursement_orphan_monitor':
      return handleDisbursementOrphanMonitor();

    case 'payment_requests_expire':
      return handlePaymentRequestsExpire();

    case 'accounting_balance_drift':
      return handleAccountingBalanceDrift();

    case 'gl_cash_reconciliation':
      return handleGLCashReconciliation();

    case 'journal_lines_partition_maintenance':
      return handleJournalLinesPartitionMaintenance();

    case 'governance_compute_metrics':
      return handleGovernanceComputeMetrics(job.payload);

    case 'cleanup_expired_tokens':
      return handleCleanupExpiredTokens();

    case 'notify_loan_due_alerts':
      return handleLoanDueAlerts(job);

    case 'notify_contribution_reminders':
      return handleContributionReminders(job);

    case 'sms_birthday_reminders':
      return handleSmsBirthdayReminders(job);

    case 'sms_bulk_send':
      return handleSmsBulkSend(job.payload, job.id);

    case 'sms_retry_failed':
      return handleSmsRetryFailed();

    case 'sms_process_schedules':
      return handleSmsProcessSchedules();

    case 'sms_poll_dlr':
      return handleSmsPollDlr();

    case 'sms_trigger_fire':
      return handleSmsTriggerFire(job.payload);

    case 'sms_low_balance_alert':
      return handleSmsLowBalanceAlert(job.payload);

    case 'sms_release_stale_reservations':
      return handleSmsReleaseStaleReservations();

    case 'sms_allowance_monthly_reset':
      return handleSmsAllowanceMonthlyReset();

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

/**
 * OPTIMIZATION_CLEANUP_AUDIT.md High #6 — launchCampaign's per-recipient
 * insert+enqueue loop previously ran directly inside the launch HTTP
 * request (uncapped, one round trip per recipient). Routes now enqueue
 * this job instead and return immediately; the loop runs here, off the
 * request path, with the job queue's own retry/backoff.
 */
async function handleEmailCampaignLaunch(payload: Record<string, unknown>): Promise<HandlerResult> {
  const campaignId = payload.campaignId ? String(payload.campaignId) : '';
  if (!campaignId) return { message: 'Email campaign launch skipped: no campaignId' };

  const { launchCampaign } = await import('@/lib/services/campaign.service');
  await launchCampaign(campaignId);
  return { message: 'Email campaign launched', campaignId };
}

async function handleEmailRetryFailed(): Promise<HandlerResult> {
  const { retryFailedEmails } = await import('@/lib/services/scheduler.service');
  const result = await retryFailedEmails();
  return { message: 'Failed emails retried', ...flattenResult(result) };
}

/**
 * Send one templated email. Replaces lib/queue's Redis fan-out — every
 * `queueEmail()` call now enqueues this job type instead of a Redis item.
 * Throwing on failure lets the processor's existing retry/backoff handle
 * it, the same guarantee the old queue's requeueWithBackoff/DLQ gave.
 */
async function handleEmailSend(payload: Record<string, unknown>): Promise<HandlerResult> {
  const { sendTemplatedEmail } = await import('@/lib/services/email.service');
  const to = Array.isArray(payload.to) ? payload.to.map(String) : String(payload.to ?? '');
  const templateKey = String(payload.templateKey ?? '');

  const result = await sendTemplatedEmail({
    templateKey,
    to,
    vars:          (payload.vars ?? {}) as Record<string, string | number | boolean | null | undefined>,
    groupId:       payload.groupId ? String(payload.groupId) : null,
    userId:        payload.userId  ? String(payload.userId)  : undefined,
    referenceId:   payload.referenceId   ? String(payload.referenceId)   : undefined,
    referenceType: payload.referenceType ? String(payload.referenceType) : undefined,
  });

  if (!result.success) throw new Error(result.error ?? `Email send failed (${templateKey})`);
  return { message: `Email sent (${templateKey})`, provider: result.provider };
}

/**
 * Drain a batch of due email_campaign_recipients rows for in-flight
 * campaigns — the replacement for email_queue_drain's Redis-based
 * per-recipient fan-out (OPTIMIZATION_CLEANUP_AUDIT.md's lib/queue +
 * lib/jobs merge). See drainCampaignRecipients() for the claim query.
 */
async function handleEmailCampaignDrain(): Promise<HandlerResult> {
  const { drainCampaignRecipients } = await import('@/lib/services/campaign.service');
  const result = await drainCampaignRecipients();
  return { message: `Email campaign drain (${result.sent} sent, ${result.failed} failed of ${result.processed})`, ...result };
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

async function handleEmailMemberStatements(): Promise<HandlerResult> {
  const { sendAllGroupMemberStatements } = await import('@/lib/services/statement-email.service');
  const result = await sendAllGroupMemberStatements();
  return { message: `Member statements sent (${result.sent} sent, ${result.skipped} skipped, ${result.groups} groups)`, ...result };
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

async function handlePaymentRequestsExpire(): Promise<HandlerResult> {
  const { expireDueRequests } = await import('@/lib/services/payment-requests.service');
  const result = await expireDueRequests();
  return { message: 'Payment requests expiry sweep complete', ...result };
}

/**
 * Stuck-payout monitor across every outbound money path. All three share the
 * same limitation (Safaricom offers no generic "query by conversation ID"
 * without a receipt), so none of them can auto-resolve — the job's job is to
 * make sure money never sits in an unknown state *silently*. Each is logged
 * by its own service; this handler aggregates the counts for the run record.
 */
async function handleDisbursementOrphanMonitor(): Promise<HandlerResult> {
  const { findStuckDisbursements }  = await import('@/lib/services/disbursements.service');
  const { findStuckSettlements }    = await import('@/lib/services/settlements.service');
  const { findStuckVendorPayments } = await import('@/lib/services/vendor-payments.service');

  const [disbursements, settlements, vendorPayments] = await Promise.all([
    findStuckDisbursements(),
    findStuckSettlements(),
    findStuckVendorPayments(),
  ]);
  const total = disbursements.count + settlements.count + vendorPayments.count;

  return {
    message: total === 0
      ? 'Outbound payments: no stuck payouts'
      : `Outbound payments: ${total} STUCK payout(s) — investigate against the Safaricom statement`,
    stuck:               total,
    stuckDisbursements:  disbursements.count,
    stuckSettlements:    settlements.count,
    stuckVendorPayments: vendorPayments.count,
  };
}

async function handleAccountingBalanceDrift(): Promise<HandlerResult> {
  const { detectBalanceDrift } = await import('@/lib/services/accounting.service');
  const result = await detectBalanceDrift();
  return { message: 'Balance drift audit complete', ...result };
}

async function handleGLCashReconciliation(): Promise<HandlerResult> {
  const { reconcileGLCashToMpesaBalance } = await import('@/lib/services/accounting.service');
  const result = await reconcileGLCashToMpesaBalance();
  const message = {
    ok:              'GL cash reconciliation: matches the real M-Pesa balance',
    mismatch:        `GL cash reconciliation: MISMATCH — GL ${result.glCashTotal} vs M-Pesa ${result.mpesaBalance} (diff ${result.difference}) — investigate`,
    no_snapshot:     'GL cash reconciliation: no balance snapshot available yet',
    stale_snapshot:  `GL cash reconciliation: latest balance snapshot is stale (${result.snapshotAge} old) — skipped`,
  }[result.status];
  return { message, ...result };
}

async function handleJournalLinesPartitionMaintenance(): Promise<HandlerResult> {
  const { ensureJournalLinesPartitions } = await import('@/lib/services/journal-lines-partitions.service');
  const result = await ensureJournalLinesPartitions();
  return {
    message: `journal_lines partitions ensured through 3 months ahead (${result.created.length} checked)`,
    ...result,
  };
}

// ── Governance handler ────────────────────────────────────────

async function handleGovernanceComputeMetrics(payload?: Record<string, unknown>): Promise<HandlerResult> {
  const { computeGovernanceForAllGroups } = await import('@/lib/services/governance.service');
  // asOf defaults to today; a payload override lets a manual/backfill run
  // target a specific period-end date.
  const asOf = typeof payload?.asOf === 'string' ? payload.asOf : new Date().toISOString().slice(0, 10);
  const result = await computeGovernanceForAllGroups(asOf);
  return {
    message: `governance metrics computed for ${result.succeeded}/${result.groups} groups (${result.alertsRaised} alerts raised, ${result.failed} failed)`,
    ...result,
  };
}

// ── Cleanup handler ───────────────────────────────────────────

async function handleCleanupExpiredTokens(): Promise<HandlerResult> {
  const { rowCount } = await pool.query(
    `DELETE FROM refresh_tokens WHERE expires_at < NOW()`,
  );
  return { message: 'Expired refresh tokens removed', deleted: rowCount ?? 0 };
}

// ── Notification handlers (E10.2) ─────────────────────────────

async function handleLoanDueAlerts(job: Job): Promise<HandlerResult> {
  const { renderBuiltin, TEMPLATE_KEYS } = await import('@/lib/sms/templates');
  const { sendOnce } = await import('@/lib/services/reminder.service');

  // Discrete day-offset stages, not a rolling "within 3 days OR overdue"
  // window — reminder_dispatch_log dedupes per stage via sendOnce(), so a
  // given installment is only ever notified once per stage no matter how
  // many days this daily cron runs while it sits in 'pending'. Overdue
  // buckets are ranges (not exact days) so a missed cron tick still catches
  // the stage on the next run instead of skipping it silently.
  // The platform paybill — same source mpesa-stk.service.ts's STK-failure
  // nudge already uses for "here's how to actually pay" SMS copy.
  const paybill = process.env.MPESA_WORKING_SHORTCODE ?? process.env.MPESA_SHORTCODE ?? '';

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
    days_until_due:  number;
    reminder_stage:  string;
    membership_no:   string;
  }>(
    `WITH candidates AS (
       SELECT lr.id AS repayment_id, lr.group_id, lr.member_id, m.phone, m.first_name,
              lr.total_due, lr.closing_balance,
              to_char(lr.due_date, 'DD Mon YYYY') AS due_date,
              lr.penalty_amount,
              (lr.due_date - CURRENT_DATE)::int AS days_until_due,
              gm.membership_no
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
          AND lr.due_date <= CURRENT_DATE + INTERVAL '3 days'
     ),
     staged AS (
       SELECT *,
         CASE
           WHEN days_until_due = 3              THEN 'due_3_days'
           WHEN days_until_due = 0               THEN 'due_today'
           WHEN days_until_due BETWEEN -6  AND -3 THEN 'overdue_3_days'
           WHEN days_until_due BETWEEN -13 AND -7 THEN 'overdue_7_days'
           WHEN days_until_due <= -14              THEN 'overdue_14_days'
         END AS reminder_stage
       FROM candidates
     )
     SELECT * FROM staged
      WHERE reminder_stage IS NOT NULL
      ORDER BY days_until_due ASC
      LIMIT 500`,
  );

  if (rows.length === 0) {
    return { message: 'Loan-due alerts: no candidates', attempted: 0, sent: 0, skipped: 0, failed: 0 };
  }

  let sent = 0, skipped = 0, failed = 0;
  for (const r of rows) {
    const overdue = r.days_until_due < 0;
    // 'L' — loan repayment — the same product-suffix convention
    // parseAccountRef()/composeMembershipNo() already document
    // (lib/utils/membership-no.ts) and the one-off Fionas disbursement SMS
    // already used by hand (scripts/send-fionas-disbursement-sms.ts).
    const accountNumber = `${r.membership_no}L`;
    const body = overdue
      ? renderBuiltin(TEMPLATE_KEYS.LOAN_OVERDUE, {
          first_name:     r.first_name,
          amount:         r.total_due,
          penalty_amount: r.penalty_amount,
          paybill,
          account_number: accountNumber,
        })
      : renderBuiltin(TEMPLATE_KEYS.LOAN_REPAYMENT_DUE, {
          first_name: r.first_name,
          amount:     r.total_due,
          due_date:   r.due_date,
          balance:    r.closing_balance,
          paybill,
          account_number: accountNumber,
        });

    const result = await sendOnce({
      groupId:        r.group_id,
      memberId:       r.member_id,
      phone:          r.phone,
      body,
      referenceType:  'loan_repayment',
      referenceId:    r.repayment_id,
      reminderStage:  r.reminder_stage,
      jobExecutionId: job.id,
      // Phase 2b (docs/messaging/UNIFIED_MESSAGING_ARCHITECTURE.md Decision B):
      // bundled allowance now exists, so this real send-path bills.
      billingMode:    'billed',
    });
    if (result.sent) sent++;
    else if (result.status === 'already_sent' || result.status === 'already_suppressed') skipped++;
    else failed++;
  }

  return {
    message: `Loan-due alerts processed (${rows.length} candidates)`,
    attempted: rows.length, sent, skipped, failed,
  };
}

/**
 * Birthday SMS — the SMS half of sms_group_settings.auto_send_birthday
 * (docs/chama-reminder/CHAMA_REMINDER_ARCHITECTURE_INTEGRATION.md §6/Phase 1).
 * The birthday-email equivalent (member-email.service.ts's sendBirthdayEmails,
 * job email_birthday) sends unconditionally to every group; this one is
 * gated on the per-group opt-in column (DEFAULT false) since it's billed
 * (Decision B — bill everything) and a group shouldn't get charged for a
 * channel it never turned on.
 *
 * A member in N active groups with the setting on gets N separate messages,
 * one per group (billed to that group), matching how loan/contribution
 * reminders already work per-membership rather than per-person.
 *
 * reminder_stage encodes the current year so the same member's birthday
 * fires again next year — reminder_dispatch_log's UNIQUE constraint would
 * otherwise treat "this member's birthday" as a single lifetime event.
 * Deliberately no custom-template lookup (unlike sendTemplated()): this
 * mirrors handleLoanDueAlerts/handleContributionReminders's own pattern of
 * using renderBuiltin directly — per-group message customization here is
 * new scope, not part of finishing the already-half-built feature.
 */
async function handleSmsBirthdayReminders(job: Job): Promise<HandlerResult> {
  const { renderBuiltin, TEMPLATE_KEYS } = await import('@/lib/sms/templates');
  const { sendOnce } = await import('@/lib/services/reminder.service');

  const { rows } = await pool.query<{
    membership_id: string;
    member_id:     string;
    group_id:      string;
    phone:         string;
    first_name:    string;
    group_name:    string;
  }>(
    // gm.id (the membership row), not m.id, is the reference_id — same
    // reasoning as handleContributionReminders: reminder_dispatch_log's
    // UNIQUE constraint is (reference_type, reference_id, reminder_stage)
    // with no group_id in the key, so a member in two opted-in groups keyed
    // on member_id would have the second group's claim collide with the
    // first (already 'sent') and silently never send/bill. gm.id is unique
    // per (group, member), so each membership gets its own claim.
    `SELECT gm.id AS membership_id, m.id AS member_id, gm.group_id, m.phone, m.first_name, g.name AS group_name
       FROM members m
       JOIN group_members gm ON gm.member_id = m.id
       JOIN groups  g        ON g.id = gm.group_id
       JOIN sms_group_settings sgs ON sgs.group_id = gm.group_id
      WHERE gm.status = 'active'
        AND g.status  = 'active'
        AND sgs.auto_send_birthday = true
        AND m.phone IS NOT NULL AND m.phone <> ''
        AND m.date_of_birth IS NOT NULL
        AND EXTRACT(MONTH FROM m.date_of_birth) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(DAY   FROM m.date_of_birth) = EXTRACT(DAY   FROM CURRENT_DATE)
      ORDER BY gm.group_id, m.id
      LIMIT 1000`,
  );

  if (rows.length === 0) {
    return { message: 'Birthday SMS: no candidates', attempted: 0, sent: 0, skipped: 0, failed: 0 };
  }

  const currentYear = new Date().getUTCFullYear();
  let sent = 0, skipped = 0, failed = 0;

  for (const r of rows) {
    const body = renderBuiltin(TEMPLATE_KEYS.BIRTHDAY, {
      first_name: r.first_name,
      group_name: r.group_name,
    });

    const result = await sendOnce({
      groupId:        r.group_id,
      memberId:       r.member_id,
      phone:          r.phone,
      body,
      referenceType:  'birthday',
      referenceId:    r.membership_id,
      reminderStage:  `birthday:${currentYear}`,
      jobExecutionId: job.id,
      billingMode:    'billed',
    });
    if (result.sent) sent++;
    else if (result.status === 'already_sent' || result.status === 'already_suppressed') skipped++;
    else failed++;
  }

  return {
    message: `Birthday SMS processed (${rows.length} candidates)`,
    attempted: rows.length, sent, skipped, failed,
  };
}

async function handleContributionReminders(job: Job): Promise<HandlerResult> {
  const { renderTemplate } = await import('@/lib/sms/templates');
  const { sendOnce } = await import('@/lib/services/reminder.service');

  // Active members of active groups who recorded NO completed contribution
  // in the previous calendar month. NOT EXISTS keeps the planner using
  // idx_contributions_member_id (member_id, status, contribution_date is
  // already covered well enough at our cardinality). gm.id doubles as the
  // reminder's reference_id — a missed month has no row of its own to
  // reference, so the stable membership row stands in, with the actual
  // period folded into reminder_stage so each month is a distinct claim.
  const { rows } = await pool.query<{
    membership_id: string;
    group_id:      string;
    member_id:     string;
    phone:         string;
    first_name:    string;
    group_name:    string;
    last_month:    string;
    period_key:    string;
  }>(
    `SELECT gm.id AS membership_id,
            gm.group_id,
            gm.member_id,
            m.phone,
            m.first_name,
            g.name AS group_name,
            to_char(date_trunc('month', CURRENT_DATE) - INTERVAL '1 month', 'Mon YYYY') AS last_month,
            to_char(date_trunc('month', CURRENT_DATE) - INTERVAL '1 month', 'YYYY-MM')  AS period_key
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
    return { message: 'Contribution reminders: no candidates', attempted: 0, sent: 0, skipped: 0, failed: 0 };
  }

  const template =
    'Dear {{first_name}}, our records show no contribution for {{group_name}} in {{last_month}}. ' +
    'Kindly contribute when you can. Thank you.';

  let sent = 0, skipped = 0, failed = 0;
  for (const r of rows) {
    const result = await sendOnce({
      groupId:        r.group_id,
      memberId:       r.member_id,
      phone:          r.phone,
      body:           renderTemplate(template, {
        first_name: r.first_name,
        group_name: r.group_name,
        last_month: r.last_month,
      }),
      referenceType:  'contribution_reminder',
      referenceId:    r.membership_id,
      reminderStage:  `missing_contribution:${r.period_key}`,
      jobExecutionId: job.id,
      // Phase 2b (docs/messaging/UNIFIED_MESSAGING_ARCHITECTURE.md Decision B):
      // bundled allowance now exists, so this real send-path bills.
      billingMode:    'billed',
    });
    if (result.sent) sent++;
    else if (result.status === 'already_sent' || result.status === 'already_suppressed') skipped++;
    else failed++;
  }

  return {
    message: `Contribution reminders processed (${rows.length} candidates)`,
    attempted: rows.length, sent, skipped, failed,
  };
}

// ── SMS dispatch handler ──────────────────────────────────────

// Above this many recipients, fan out via QStash instead of one in-process
// loop — see the handler's own doc comment (SMS_MESSAGING_AUDIT_2026-08.md
// H3 / SMS-007/SMS-015). 100 keeps a single-chunk (unchunked) campaign
// comfortably inside the current provider-batch size (sendBulkCampaign's
// own internal batchSize is 200) while giving genuinely large campaigns
// real per-chunk isolation.
const QSTASH_CHUNK_THRESHOLD = 100;
const QSTASH_CHUNK_SIZE = 50;

/**
 * Durable bulk/campaign SMS dispatch. Enqueued by /sms/bulk and /sms/campaign
 * so the provider calls survive serverless instance termination (the old
 * setImmediate path silently dropped them). Billing + opt-out + log creation
 * + provider dispatch all happen here, inside the retry-managed job.
 *
 * Chunking (closes SMS_MESSAGING_AUDIT_2026-08.md H3 / SMS-007/SMS-015 —
 * docs/messaging/UNIFIED_MESSAGING_ARCHITECTURE.md Phase 3 item 10):
 * above QSTASH_CHUNK_THRESHOLD recipients, this handler's job changes from
 * "dispatch every recipient" to "split into QSTASH_CHUNK_SIZE-recipient
 * chunks and publish each to QStash" (lib/queue/qstash.ts) — each chunk is
 * then delivered as its own independent call to /api/v1/workers/
 * sms-dispatch-chunk, with QStash's own per-chunk retry/DLQ budget instead
 * of one shared function-timeout for the whole campaign. If publishing
 * itself throws partway through, this handler throws too and job_queue
 * retries the WHOLE publish loop — safe because every chunk's dispatchKey
 * is `${jobId}:chunk:${i}`, stable across retries of this job, so a
 * chunk already delivered dedupes against itself exactly like the
 * unchunked path already dedupes a retried job (H3 below).
 *
 * Below the threshold — or when QStash isn't configured for this
 * environment (see lib/queue/qstash.ts's header comment) — dispatch is
 * unchanged: one direct sendBulkCampaign call, in-process, exactly as
 * before this existed.
 */
async function handleSmsBulkSend(payload: Record<string, unknown>, jobId: string): Promise<HandlerResult> {
  const { smsService, resolveRecipientVars } = await import('@/lib/services/sms.service');
  const phones = Array.isArray(payload.phones) ? (payload.phones as string[]) : [];
  if (!payload.groupId || phones.length === 0) {
    return { message: 'SMS bulk send skipped: no recipients', sent: 0, failed: 0 };
  }

  // Per-recipient template rendering happens HERE rather than at any of the
  // enqueue sites, because this handler is the one point all four bulk paths
  // funnel through (/sms/bulk, /sms/campaign's immediate send, and the
  // scheduler's two — processDueSmsSchedules and processDueScheduledCampaigns).
  // Rendering at enqueue time would have to be repeated at each, and the
  // immediate-campaign route in particular never did it — every campaign
  // written with a {{first_name}} placeholder has been delivering that text
  // literally. Resolving at dispatch time also means the names match current
  // membership, the same guarantee resolveSmsRecipients() already gives the
  // recipient list itself.
  //
  // Skipped entirely for messages with no placeholder — the overwhelmingly
  // common case — so an ordinary campaign costs no extra queries.
  const message = String(payload.message ?? '');
  const varsByPhone = message.includes('{{')
    ? await resolveRecipientVars(String(payload.groupId), phones)
    : undefined;

  // An organization-funded campaign carries its payer through the queue, so a
  // job retried after a restart still bills the organization, not the group.
  const payer = payload.fundedBy === 'organization' && payload.payerOrganizationId
    ? { type: 'organization' as const, organizationId: String(payload.payerOrganizationId) }
    : undefined;

  const campaignId    = payload.campaignId    ? String(payload.campaignId)    : undefined;
  const senderId       = payload.senderId      ? String(payload.senderId)      : undefined;
  const timeToSend     = payload.timeToSend    ? String(payload.timeToSend)    : undefined;
  const referenceType  = payload.referenceType ? String(payload.referenceType) : undefined;
  const referenceId    = payload.referenceId   ? String(payload.referenceId)   : undefined;
  const sentBy         = String(payload.sentBy ?? '');
  const groupId        = String(payload.groupId);

  const { isQstashConfigured, publishSmsChunk } = await import('@/lib/queue/qstash');

  if (phones.length > QSTASH_CHUNK_THRESHOLD && isQstashConfigured()) {
    // Normalized up front: varsByPhone (resolveRecipientVars) is keyed by
    // normalizePhone() output, and sendBulkCampaign itself re-normalizes
    // whatever it receives anyway (idempotent), so sending already-normalized
    // numbers through the chunk payload changes nothing downstream — it just
    // makes the varsByPhone.get(p) lookup below actually match.
    const normalizedPhones = phones.map(normalizePhone);
    const chunks: string[][] = [];
    for (let i = 0; i < normalizedPhones.length; i += QSTASH_CHUNK_SIZE) chunks.push(normalizedPhones.slice(i, i + QSTASH_CHUNK_SIZE));

    for (let i = 0; i < chunks.length; i++) {
      const chunkPhones = chunks[i];
      const chunkVars = varsByPhone
        ? Object.fromEntries(chunkPhones.flatMap((p) => (varsByPhone.has(p) ? [[p, varsByPhone.get(p)!]] : [])))
        : undefined;

      await publishSmsChunk({
        jobId, chunkIndex: i, chunkCount: chunks.length,
        groupId, campaignId, phones: chunkPhones, message,
        senderId, timeToSend, referenceType, referenceId, sentBy,
        totalRecipientCount: phones.length,
        fundedBy:             payer?.type === 'organization' ? 'organization' : undefined,
        payerOrganizationId:  payer?.type === 'organization' ? payer.organizationId : undefined,
        varsByPhone: chunkVars,
      });
    }

    return {
      message: `SMS bulk send chunked (${chunks.length} chunks published, ${phones.length} recipients)`,
      chunked: true, chunks: chunks.length, recipients: phones.length,
    };
  }

  const result = await smsService.sendBulkCampaign({
    campaignId, phones, message, varsByPhone,
    senderId, timeToSend, groupId, sentBy, referenceType, referenceId,
    payer,
    // SMS_MESSAGING_AUDIT_2026-08.md H3 — job_queue.id is stable across
    // retries of the same job (only `attempts` changes), so it's a safe
    // dedup key for ad-hoc sends that carry no real campaignId. Harmless to
    // always pass: sendBulkCampaign prefers campaignId when both are set.
    dispatchBatchId: jobId,
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
 * Warn officers that SMS credits have run out or fallen below their threshold.
 *
 * Delivered by in-app notification and email ONLY — never by SMS. A payer is
 * alerted precisely when it cannot afford to send an SMS, so routing this
 * through notifyMember would make the warning unsendable exactly when it is
 * needed. Please do not "unify" this into the messaging pipeline.
 */
async function handleSmsLowBalanceAlert(payload: Record<string, unknown>): Promise<HandlerResult> {
  const { withAdminDb } = await import('@/lib/db');
  const { queueEmail }  = await import('@/lib/services/email.service');

  const payerType = String(payload.payerType ?? 'group');
  const groupId   = payload.groupId ? String(payload.groupId) : null;
  const orgId     = payload.organizationId ? String(payload.organizationId) : null;

  const title = 'SMS credits exhausted';
  const body  = 'Your group has run out of SMS credits, so automated reminders and notifications are not being sent. Top up to resume messaging.';

  let recipients = 0;

  if (payerType === 'group' && groupId) {
    // In-app rows for every active officer who can act on it.
    recipients = await withAdminDb((db) =>
      db.query(
        `INSERT INTO notifications (group_id, member_id, type, title, body, reference_type)
         SELECT gm.group_id, gm.member_id, 'in_app', $2, $3, 'sms_low_balance'
         FROM group_members gm
         WHERE gm.group_id = $1 AND gm.is_active
           AND gm.role IN ('chairperson','treasurer')`,
        [groupId, title, body],
      ).then((r) => r.rowCount ?? 0),
    );

    const { rows } = await withAdminDb((db) =>
      db.query<{ email: string }>(
        `SELECT m.email
         FROM group_members gm JOIN members m ON m.id = gm.member_id
         WHERE gm.group_id = $1 AND gm.is_active
           AND gm.role IN ('chairperson','treasurer') AND m.email IS NOT NULL
         LIMIT 5`,
        [groupId],
      ),
    );
    for (const r of rows) {
      await queueEmail({
        to:          r.email,
        templateKey: 'sms_low_balance',
        vars:        { title, body },
        groupId,
        referenceType: 'sms_low_balance',
      }).catch(() => { /* best-effort */ });
    }
  } else if (payerType === 'organization' && orgId) {
    const { rows } = await withAdminDb((db) =>
      db.query<{ email: string }>(
        `SELECT m.email
         FROM organization_members om JOIN members m ON m.id = om.member_id
         WHERE om.organization_id = $1 AND om.is_active
           AND om.org_role = 'lead' AND m.email IS NOT NULL
         LIMIT 5`,
        [orgId],
      ),
    );
    for (const r of rows) {
      await queueEmail({
        to:            r.email,
        templateKey:   'sms_low_balance',
        vars:          { title, body },
        referenceType: 'sms_low_balance',
      }).catch(() => { /* best-effort */ });
      recipients++;
    }
  }

  return { message: `Low-balance alert raised (${recipients} recipient(s))`, recipients };
}

/**
 * Recover SMS credit reservations orphaned by a crash.
 *
 * notifyMember runs as a series of independent autocommit statements with no
 * enclosing transaction, so a process death between the provider call and the
 * settle write leaves an earmark stranded. A `finally` cannot cover that case;
 * this sweeper is the backstop.
 *
 * The release/consume split is the whole point and must not be simplified into
 * "release everything stale": a row the provider already accepted has already
 * cost real money, so releasing it would hand out free SMS every time a settle
 * write fails. Only rows the provider never confirmed are returned.
 */
async function handleSmsReleaseStaleReservations(): Promise<HandlerResult> {
  const { withAdminDb }        = await import('@/lib/db');
  const { settleReservation }  = await import('@/lib/services/messaging-billing');

  const { rows } = await withAdminDb((db) =>
    db.query<{ id: string; provider_msg_id: string | null; status: string }>(
      `SELECT id, provider_msg_id, status
       FROM sms_usage_logs
       WHERE billing_state = 'reserved'
         AND reserved_at < NOW() - INTERVAL '15 minutes'
       ORDER BY reserved_at ASC
       LIMIT 500`,
    ),
  );

  const consumeIds = rows
    .filter((r) => r.provider_msg_id !== null || r.status === 'sent' || r.status === 'delivered')
    .map((r) => r.id);
  const releaseIds = rows.filter((r) => !consumeIds.includes(r.id)).map((r) => r.id);

  await settleReservation(consumeIds, 'consume');
  await settleReservation(releaseIds, 'release');

  return {
    message:  `Stale reservations settled (${consumeIds.length} consumed, ${releaseIds.length} released)`,
    consumed: consumeIds.length,
    released: releaseIds.length,
  };
}

/**
 * Zero the bundled SMS allowance for groups whose billing anniversary has
 * arrived. Phase 2b (docs/messaging/UNIFIED_MESSAGING_ARCHITECTURE.md), moved
 * off the 1st-of-month sweep onto per-group anniversaries by migration 151 —
 * hence DAILY, not monthly. The handler name is kept so the job_queue type
 * and its dedup history stay continuous.
 */
async function handleSmsAllowanceMonthlyReset(): Promise<HandlerResult> {
  const { resetDueSmsAllowances } = await import('@/lib/services/messaging-billing');
  const result = await resetDueSmsAllowances();
  return { message: `SMS allowance reset for ${result.groupsReset} group(s)`, ...result };
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
