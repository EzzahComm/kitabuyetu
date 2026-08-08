/**
 * SMS orchestration layer.
 *
 * Wraps textsms.service.ts (raw TextSMS Kenya API) and handles:
 *  - Credit deduction + usage logging in a single atomic transaction.
 *  - Per-group opt-out list enforcement.
 *  - Failure logging and queued retry.
 *  - Campaign send tracking.
 *  - Template rendering via lib/sms/templates.ts.
 *
 * Public interface is intentionally stable so existing route handlers
 * (sms/send, mpesa callback, billing) need no changes.
 */

import { withTransaction, withDb, withAdminDb, type TenantContext } from '@/lib/db';
import { normalizePhone } from '@/lib/utils/phone';
import { InsufficientSmsCreditsError, PaymentRequiredError, NotFoundError } from '@/lib/utils/errors';
import { logger } from '@/lib/logger';
import {
  sendSingleSms,
  sendBulkSmsChunked,
  getDeliveryReport,
  getProviderBalance,
  type BulkSmsItem,
} from './textsms.service';
import { renderTemplate, renderBuiltin, type TemplateVars, type TemplateKey } from '@/lib/sms/templates';
import {
  reserveCredits,
  settleReservation,
  raiseLowBalanceAlert,
  type ReservationTarget,
  type ReserveFailure,
} from './messaging-billing';
import type { SmsUsageLog, PaginatedResult } from '@/types/db.types';
import type { SmsUsageQueryInput } from '@/lib/validators/sms.schema';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SendSmsResult {
  sent:    number;
  failed:  number;
  logs:    SmsUsageLog[];
}

export type DlrClass = 'delivered' | 'failed' | 'pending';

/**
 * Map a raw provider delivery status to our domain class. Conservative by
 * design: anything not clearly terminal (in-transit, accepted, unknown,
 * numeric/blank) classifies as 'pending' so a not-yet-delivered message is
 * never marked 'failed'. Failure patterns are checked first so 'UNDELIV'
 * isn't caught by the 'deliv' substring.
 */
export function classifyDlrStatus(raw: string): DlrClass {
  const s = (raw ?? '').toLowerCase();
  if (/undeliv|fail|reject|expir|delet|invalid|error|blocked/.test(s)) return 'failed';
  if (/deliv|success|delivrd/.test(s)) return 'delivered';
  return 'pending';
}

/**
 * Who pays for a send.
 *
 * A group may be overseen by several organizations, so the payer can never be
 * inferred from the group — it is stated by the caller and recorded on every
 * sms_usage_logs row. Organization-scoped trigger rules and organization
 * campaigns bill the organization; everything else bills the group.
 */
export type SmsPayer =
  | { type: 'group' }
  | { type: 'organization'; organizationId: string };

export const GROUP_PAYER: SmsPayer = { type: 'group' };

export interface BulkCampaignInput {
  campaignId?: string;
  phones:      string[];
  message:     string;
  senderId?:   string;
  timeToSend?: string;
  groupId:     string;
  sentBy:      string;
  referenceType?: string;
  referenceId?:   string;
  payer?:      SmsPayer;
}

// ─── Credit helpers ───────────────────────────────────────────────────────────
//
// The provider SQLSTATE constants that used to live here moved to
// lib/services/messaging-billing.ts along with debitPayer's logic — mapping
// them in one place is the point of that module.

/**
 * Map this module's payer shape onto the shared reservation target.
 *
 * Billing itself now lives in lib/services/messaging-billing.ts, which is the
 * single place credits are earmarked, charged or returned — the balance check,
 * the row lock and the `FOR UPDATE OF ba` that Phase 1 fixed all moved into
 * reserve_sms_credits() (migration 123).
 */
function toReservationTarget(groupId: string, payer: SmsPayer): ReservationTarget {
  return payer.type === 'organization'
    ? { payerType: 'organization', groupId, organizationId: payer.organizationId }
    : { payerType: 'group', groupId };
}

/**
 * Convert a reservation failure into the error this module's callers expect.
 * `/sms/send` turns PaymentRequiredError/InsufficientSmsCreditsError into a
 * 402, and trigger-engine.ts catches to drive retryOrFail — so this path must
 * keep throwing even though the primitive underneath never does.
 */
function reserveFailureToError(reason: ReserveFailure, detail: string): Error {
  switch (reason) {
    case 'insufficient_credits': return new InsufficientSmsCreditsError();
    case 'subscription_inactive': return new PaymentRequiredError('Subscription inactive. SMS cannot be sent.');
    case 'not_authorized':        return new PaymentRequiredError('This organization cannot fund SMS for this group.');
    case 'no_billing_account':    return new PaymentRequiredError('No billing account found.');
    default:                      return new PaymentRequiredError(detail);
  }
}

/** payer_type / payer_organization_id columns for an sms_usage_logs insert. */
function payerCols(payer: SmsPayer): [string, string | null] {
  return payer.type === 'organization'
    ? ['organization', payer.organizationId]
    : ['group', null];
}

async function fetchOptOuts(client: import('pg').PoolClient, groupId: string): Promise<Set<string>> {
  const { rows } = await client.query<{ opt_out_phones: string[] }>(
    `SELECT opt_out_phones FROM sms_group_settings WHERE group_id=$1`, [groupId],
  );
  return new Set(rows[0]?.opt_out_phones ?? []);
}

// ─── Recipient resolution ──────────────────────────────────────────────────

/**
 * Resolve a campaign/schedule recipient definition to a list of normalized
 * phone numbers. Shared by the campaign route (immediate send) and the
 * scheduler (deferred send) so both resolve membership identically — and
 * always against *current* membership at send time.
 */
export async function resolveSmsRecipients(
  groupId:       string,
  recipientType: string,
  rawRecipients: unknown,
): Promise<string[]> {
  if (recipientType === 'all_members' || recipientType === 'active_members') {
    const activeOnly = recipientType === 'active_members';
    const { rows } = await withAdminDb((db) =>
      db.query<{ phone: string }>(
        `SELECT m.phone FROM members m
         JOIN group_members gm ON gm.member_id = m.id
         WHERE gm.group_id=$1 ${activeOnly ? 'AND gm.is_active' : ''} AND m.phone IS NOT NULL`,
        [groupId],
      ),
    );
    return rows.map((r) => normalizePhone(r.phone));
  }

  if (recipientType === 'custom_phones') {
    const phones = (rawRecipients as { phones?: string[] })?.phones ?? [];
    return phones.map(normalizePhone);
  }

  if (recipientType === 'selected') {
    const ids = (rawRecipients as { memberIds?: string[] })?.memberIds ?? [];
    if (!ids.length) return [];
    const { rows } = await withAdminDb((db) =>
      db.query<{ phone: string }>(
        `SELECT m.phone FROM members m
         JOIN group_members gm ON gm.member_id = m.id
         WHERE m.id=ANY($1::uuid[]) AND gm.group_id=$2 AND m.phone IS NOT NULL`,
        [ids, groupId],
      ),
    );
    return rows.map((r) => normalizePhone(r.phone));
  }

  // Officers holding one of the given group roles — used by trigger rules that
  // notify approvers (e.g. withdrawal requests to treasurer + chairperson).
  if (recipientType === 'roles') {
    const roles = (rawRecipients as { roles?: string[] })?.roles ?? [];
    if (!roles.length) return [];
    const { rows } = await withAdminDb((db) =>
      db.query<{ phone: string }>(
        `SELECT m.phone FROM members m
         JOIN group_members gm ON gm.member_id = m.id
         WHERE gm.group_id=$1 AND gm.is_active
           AND gm.role = ANY($2::member_role[]) AND m.phone IS NOT NULL`,
        [groupId, roles],
      ),
    );
    return rows.map((r) => normalizePhone(r.phone));
  }

  return [];
}

// ─── Core send (single or multi recipients) ───────────────────────────────────

export const smsService = {

  async send(
    ctx: TenantContext,
    phones: string | string[],
    message: string,
    referenceType?: string | null,
    referenceId?: string | null,
    payer: SmsPayer = GROUP_PAYER,
  ): Promise<SmsUsageLog[]> {
    const raw        = Array.isArray(phones) ? phones : [phones];
    const normalized = raw.map(normalizePhone);

    // Bill + create 'queued' log rows atomically, then dispatch *after* the
    // transaction commits. Dispatch is awaited (not setImmediate) because
    // post-response background work is not guaranteed to run on serverless —
    // the previous setImmediate left messages stuck 'queued' while credits
    // were already debited. This path is single/few recipients (transactional
    // receipts, manual sends); large fan-out goes through sendBulkCampaign.
    const logs = await withTransaction(ctx, async (client) => {
      // Opt-outs are resolved before billing so a fully-suppressed send costs
      // nothing — for either payer.
      const optOuts  = await fetchOptOuts(client, ctx.groupId);
      const eligible = normalized.filter((p) => !optOuts.has(p));
      if (!eligible.length) return [] as SmsUsageLog[];

      // Reserve, don't debit. Credits are earmarked here and only become a real
      // charge once the provider accepts the message; a rejected send releases
      // them (SMS_MESSAGING_AUDIT_2026-08.md H5, migration 123).
      const reservation = await reserveCredits(client, toReservationTarget(ctx.groupId, payer), eligible.length);
      if (!reservation.ok) {
        // Reserve BEFORE inserting any row, so an unaffordable send leaves no
        // trace — an existing integration test pins exactly this ordering.
        void raiseLowBalanceAlert(toReservationTarget(ctx.groupId, payer));
        throw reserveFailureToError(reservation.reason, reservation.detail);
      }
      const rate = reservation.rate;
      const [payerType, payerOrgId] = payerCols(payer);

      // Phase 2b: the reservation already split this batch between the
      // bundled allowance and paid credits (migration 124) — spend the
      // allowance count down per row so each row records its own true
      // source. One row is one message, so the split is all-or-nothing per
      // row: a message is never half-allowance/half-paid.
      let allowanceLeft = reservation.fromAllowanceCount;

      const rows: SmsUsageLog[] = [];
      for (const phone of eligible) {
        const fromAllowance = allowanceLeft > 0 ? (allowanceLeft--, rate) : 0;
        const { rows: inserted } = await client.query<SmsUsageLog>(
          `INSERT INTO sms_usage_logs
             (group_id, recipient_phone, message_text, credits_deducted, credits_reserved,
              credits_from_allowance, billing_state, reserved_at, notification_type, correlation_id,
              reference_type, reference_id, provider, payer_type, payer_organization_id)
           VALUES ($1,$2,$3,0,$4,$5,'reserved',NOW(),$6,$7,$8,$9,'textsms',$10,$11) RETURNING *`,
          [ctx.groupId, phone, message, rate.toFixed(4), fromAllowance.toFixed(4),
           referenceType ?? null, referenceId ?? null,
           referenceType ?? null, referenceId ?? null, payerType, payerOrgId],
        );
        rows.push(inserted[0]);
      }
      return rows;
    });

    if (logs.length) {
      // recipient_phone preserves the eligible order the rows were inserted in,
      // so phones[i] ↔ logIds[i] pairing in dispatchBatch stays correct.
      const { sentIds, failedIds } = await dispatchBatch(
        ctx.groupId,
        logs.map((l) => l.recipient_phone),
        message,
        logs.map((l) => l.id),
      );
      // Provider accepted ⇒ charge. Provider rejected or the batch threw ⇒
      // return the earmark. A later DLR-driven failure must NOT refund: the
      // provider accepted and billed us for that one.
      await settleReservation(sentIds, 'consume');
      await settleReservation(failedIds, 'release');
    }
    return logs;
  },

  async sendTemplated(
    ctx: TenantContext,
    phones: string | string[],
    templateKey: TemplateKey,
    vars: TemplateVars,
    referenceType?: string,
    referenceId?: string,
  ): Promise<SmsUsageLog[]> {
    // Try to load group's custom template first, fall back to built-in
    const customTemplate = await withDb(ctx, async (client) => {
      const { rows } = await client.query<{ body: string }>(
        `SELECT body FROM sms_templates
         WHERE (group_id=$1 OR group_id IS NULL)
           AND template_key=$2 AND is_active=true
         ORDER BY group_id NULLS LAST LIMIT 1`,
        [ctx.groupId, templateKey],
      );
      return rows[0]?.body ?? null;
    });

    const message = customTemplate
      ? renderTemplate(customTemplate, vars)
      : renderBuiltin(templateKey, vars);

    return this.send(ctx, phones, message, referenceType, referenceId);
  },

  async sendBulkCampaign(input: BulkCampaignInput): Promise<SendSmsResult> {
    const phones = input.phones.map(normalizePhone);
    const payer  = input.payer ?? GROUP_PAYER;

    // Reservation + log creation happen in ONE transaction so credits can never
    // be earmarked without the matching log rows (and vice-versa). The provider
    // dispatch below runs *outside* this transaction so we never hold a DB
    // connection open across slow HTTP calls.
    //
    // Credits are reserved, not charged, for every eligible recipient; the
    // per-response settle below converts accepted messages into a real debit
    // and returns the earmark for rejected ones (closes SMS-009).
    const batchSize = 200;
    const { eligible, logIds } = await withAdminDb(async (db) => {
      // Opt-out suppression
      const { rows: settingsRows } = await db.query<{ opt_out_phones: string[] }>(
        `SELECT opt_out_phones FROM sms_group_settings WHERE group_id=$1`, [input.groupId],
      );
      const optOuts  = new Set(settingsRows[0]?.opt_out_phones ?? []);
      const eligible = phones.filter((p) => !optOuts.has(p));
      const logIds: string[] = [];
      if (!eligible.length) return { eligible, logIds };

      // Reserve against the stated payer: the group, or the organization
      // running the campaign. Mirrors send()'s guards for each path.
      const reservation = await reserveCredits(db, toReservationTarget(input.groupId, payer), eligible.length);
      if (!reservation.ok) {
        void raiseLowBalanceAlert(toReservationTarget(input.groupId, payer));
        throw reserveFailureToError(reservation.reason, reservation.detail);
      }
      const rate = reservation.rate;
      const [payerType, payerOrgId] = payerCols(payer);

      // Phase 2b: spend the allowance count down per row (migration 124) —
      // one row is one message, so the split is all-or-nothing per row.
      let allowanceLeft = reservation.fromAllowanceCount;

      // Insert log rows in batches, each carrying its per-message credit cost
      for (let i = 0; i < eligible.length; i += batchSize) {
        const batch = eligible.slice(i, i + batchSize);
        for (const phone of batch) {
          const fromAllowance = allowanceLeft > 0 ? (allowanceLeft--, rate) : 0;
          const { rows } = await db.query<{ id: string }>(
            `INSERT INTO sms_usage_logs
               (group_id, recipient_phone, message_text, credits_deducted, credits_reserved,
                credits_from_allowance, billing_state, reserved_at, notification_type, correlation_id,
                reference_type, reference_id, campaign_id, provider,
                payer_type, payer_organization_id)
             VALUES ($1,$2,$3,0,$4,$5,'reserved',NOW(),'campaign',$6,$7,$8,$9,'textsms',$10,$11) RETURNING id`,
            [
              input.groupId, phone, input.message, rate.toFixed(4), fromAllowance.toFixed(4),
              input.campaignId ?? null,
              input.referenceType ?? 'campaign',
              input.referenceId ?? input.campaignId ?? null,
              input.campaignId ?? null,
              payerType, payerOrgId,
            ],
          );
          logIds.push(rows[0].id);
        }
      }

      if (input.campaignId) {
        await db.query(
          `UPDATE sms_campaigns SET status='sending', started_at=NOW(),
           recipient_count=$1 WHERE id=$2`,
          [eligible.length, input.campaignId],
        );
      }

      return { eligible, logIds };
    });

    // Everyone opted out — nothing billed, nothing to dispatch.
    if (!eligible.length) return { sent: 0, failed: 0, logs: [] };

    // Dispatch via TextSMS bulk endpoint
    const items: BulkSmsItem[] = eligible.map((mobile, idx) => ({
      mobile,
      message:   input.message,
      senderId:  input.senderId,
      timeToSend: input.timeToSend,
      clientSmsId: idx + 1,
    }));

    const result = await sendBulkSmsChunked(items);

    // Update log rows with provider response
    await withAdminDb(async (db) => {
      for (let i = 0; i < result.responses.length; i++) {
        const r = result.responses[i];
        if (!logIds[i]) continue;
        await db.query(
          `UPDATE sms_usage_logs
           SET status=$1, provider_msg_id=$2, network_id=$3,
               sent_at=NOW(),
               failed_reason=$4
           WHERE id=$5`,
          [
            r.success ? 'sent' : 'failed',
            r.messageId || null,
            r.networkId || null,
            r.success ? null : r.responseDescription,
            logIds[i],
          ],
        );
      }

      if (input.campaignId) {
        await db.query(
          `UPDATE sms_campaigns
           SET status='completed', sent_count=$1, failed_count=$2, completed_at=NOW()
           WHERE id=$3`,
          [result.sent, result.failed, input.campaignId],
        );
      }
    });

    // Settle the reservation per response: accepted ⇒ charge, rejected ⇒ return
    // the earmark. Any row the provider never reported on stays 'reserved' and
    // is recovered by the stale-reservation sweeper.
    const acceptedIds: string[] = [];
    const rejectedIds: string[] = [];
    for (let i = 0; i < logIds.length; i++) {
      const r = result.responses[i];
      if (!r)              rejectedIds.push(logIds[i]);
      else if (r.success)  acceptedIds.push(logIds[i]);
      else                 rejectedIds.push(logIds[i]);
    }
    await settleReservation(acceptedIds, 'consume');
    await settleReservation(rejectedIds, 'release');

    // Log failures for retry
    for (let i = 0; i < result.responses.length; i++) {
      const r = result.responses[i];
      if (!r.success) {
        await withAdminDb((db) =>
          db.query(
            `INSERT INTO sms_failures
               (group_id, sms_log_id, phone, message, failure_code, failure_reason, next_retry_at)
             VALUES ($1,$2,$3,$4,$5,$6, NOW() + INTERVAL '5 minutes')`,
            [
              input.groupId, logIds[i] ?? null, eligible[i],
              input.message, String(r.responseCode), r.responseDescription,
            ],
          ),
        );
      }
    }

    // Return a compatible shape (logs is empty for large campaigns)
    return {
      sent:   result.sent,
      failed: result.failed,
      logs:   [],
    };
  },

  async getBalance(ctx: TenantContext): Promise<{ credits: string; rate: string }> {
    return withDb(ctx, async (client) => {
      const { rows } = await client.query<{ sms_credits: string; sms_rate: string }>(
        `SELECT ba.sms_credits, COALESCE(s.sms_rate,'0.90') AS sms_rate
         FROM billing_accounts ba
         LEFT JOIN subscriptions s ON s.group_id=ba.group_id AND s.status='active'
         WHERE ba.group_id=$1`,
        [ctx.groupId],
      );
      if (!rows[0]) return { credits: '0.00', rate: '0.90' };
      return { credits: rows[0].sms_credits, rate: rows[0].sms_rate };
    });
  },

  async getProviderBalance(memberId: string): Promise<{ balance: number; currency: string }> {
    const result = await getProviderBalance();
    // Snapshot to DB for history
    await withAdminDb((db) =>
      db.query(
        `INSERT INTO sms_provider_balances (provider, balance, currency, queried_by, raw_response)
         VALUES ('textsms',$1,$2,$3,$4)`,
        [result.balance, result.currency, memberId, JSON.stringify(result.raw)],
      ),
    );
    return { balance: result.balance, currency: result.currency };
  },

  /**
   * Fetch and persist a delivery report for one provider message id.
   *
   * `scope` is required and explicit because `messageId` is supplied by the
   * caller: a request-driven lookup must prove the message belongs to the
   * caller's own group before touching it, while the DLR polling cron
   * legitimately spans every tenant. Making the system case opt-in (rather
   * than a defaultable/omittable argument) is what stops the request path
   * from silently regaining cross-tenant reach — the shape of C3, where the
   * route never applied a group predicate at all
   * (SMS_MESSAGING_AUDIT_2026-08.md C3).
   *
   * The ownership check runs *before* the provider call, so a caller probing
   * another tenant's message id learns nothing and costs us no outbound HTTP.
   */
  async getDlr(
    messageId: string,
    scope: { groupId: string } | { system: true },
  ): Promise<{ status: DlrClass; deliveredAt?: string }> {
    if ('groupId' in scope) {
      const owned = await withAdminDb((db) =>
        db.query(
          `SELECT 1 FROM sms_usage_logs
           WHERE provider_msg_id=$1 AND group_id=$2 LIMIT 1`,
          [messageId, scope.groupId],
        ).then((r) => r.rowCount ?? 0),
      );
      if (!owned) throw new NotFoundError('Message not found');
    }

    const result = await getDeliveryReport(messageId);
    const cls    = classifyDlrStatus(result.status);

    await withAdminDb(async (db) => {
      // Only advance to a terminal state. A 'pending'/in-transit report must
      // NOT downgrade a message to 'failed' (the previous bug), and a 'failed'
      // report must not clobber a message already confirmed 'delivered'.
      if (cls === 'delivered') {
        await db.query(
          `UPDATE sms_usage_logs
           SET status='delivered', delivered_at=$2
           WHERE provider_msg_id=$1`,
          [messageId, result.deliveredAt ?? new Date().toISOString()],
        );
      } else if (cls === 'failed') {
        await db.query(
          `UPDATE sms_usage_logs
           SET status='failed', failed_reason=$2
           WHERE provider_msg_id=$1 AND status <> 'delivered'`,
          [messageId, result.status],
        );
      }

      // One row per provider message; refresh it on each poll.
      await db.query(
        `INSERT INTO sms_delivery_reports
           (provider_message_id, phone, status, network_id, delivered_at, raw_response)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (provider_message_id) DO UPDATE
           SET status       = EXCLUDED.status,
               network_id   = EXCLUDED.network_id,
               delivered_at = EXCLUDED.delivered_at,
               raw_response = EXCLUDED.raw_response,
               queried_at   = NOW()`,
        [messageId, result.phone, cls, result.networkId, result.deliveredAt ?? null, JSON.stringify(result.raw)],
      );
    });

    return { status: cls, deliveredAt: result.deliveredAt };
  },

  /**
   * Poll the provider for delivery status of messages that were sent but not
   * yet confirmed delivered/failed. Driven by the sms_poll_dlr cron job. Bounded
   * per tick (each check is one provider HTTP call). Refreshes campaign
   * delivered_count for any campaign whose messages reached a terminal state.
   */
  async pollPendingDlrs(limit = 50): Promise<{ checked: number; delivered: number; failed: number; pending: number }> {
    // Every TextSMS send path (send/bulk/retry and cron reminders) records the
    // provider message id in provider_msg_id, so that single column is the basis
    // for delivery tracking.
    const logs = await withAdminDb((db) =>
      db.query<{ id: string; msg_id: string; campaign_id: string | null }>(
        `SELECT id, provider_msg_id AS msg_id, campaign_id
         FROM sms_usage_logs
         WHERE provider_msg_id IS NOT NULL
           AND status = 'sent'
           AND sent_at IS NOT NULL
           AND sent_at <= NOW() - INTERVAL '2 minutes'
           AND sent_at >= NOW() - INTERVAL '24 hours'
         ORDER BY sent_at ASC
         LIMIT $1`,
        [limit],
      ).then((r) => r.rows),
    );

    let delivered = 0, failed = 0, pending = 0;
    const touchedCampaigns = new Set<string>();

    for (const log of logs) {
      try {
        const { status } = await this.getDlr(log.msg_id, { system: true });
        if (status === 'delivered') delivered++;
        else if (status === 'failed') failed++;
        else pending++;
        if (status !== 'pending' && log.campaign_id) touchedCampaigns.add(log.campaign_id);
      } catch (err) {
        logger.error('[sms] DLR poll error', { logId: log.id, err });
      }
    }

    // Refresh delivered_count on campaigns that gained terminal results.
    for (const campaignId of touchedCampaigns) {
      await withAdminDb((db) =>
        db.query(
          `UPDATE sms_campaigns
           SET delivered_count = (SELECT COUNT(*) FROM sms_usage_logs WHERE campaign_id=$1 AND status='delivered'),
               updated_at = NOW()
           WHERE id=$1`,
          [campaignId],
        ),
      );
    }

    logger.info(`[sms] DLR poll: ${logs.length} checked, ${delivered} delivered, ${failed} failed, ${pending} pending`);
    return { checked: logs.length, delivered, failed, pending };
  },

  /**
   * Retry persisted SMS failures that are due. Driven by the sms_retry_failed
   * cron job. Re-sends through the raw provider client (NOT send()) so the
   * credits already charged for the original attempt are not debited again.
   * Honours the opt-out list (a number that opted out after the original
   * attempt is resolved as suppressed rather than re-sent), and backs off
   * exponentially up to max_retries before giving up.
   */
  async retryFailures(limit = 100): Promise<{ retried: number; resolved: number; failed: number }> {
    const failures = await withAdminDb((db) =>
      db.query<{
        id: string; group_id: string; sms_log_id: string | null;
        phone: string; message: string; retry_count: number;
      }>(
        `SELECT id, group_id, sms_log_id, phone, message, retry_count
         FROM sms_failures
         WHERE NOT resolved
           AND retry_count < max_retries
           AND (next_retry_at IS NULL OR next_retry_at <= NOW())
         ORDER BY next_retry_at ASC NULLS FIRST
         LIMIT $1`,
        [limit],
      ).then((r) => r.rows),
    );

    const sender = process.env.TEXTSMS_SENDER_ID ?? 'KITABU';
    let retried = 0, resolved = 0, failed = 0;

    for (const f of failures) {
      retried++;

      // Consent gate — never re-send to a number that has since opted out.
      if (await this.isOptedOut(f.group_id, f.phone)) {
        await withAdminDb((db) =>
          db.query(
            `UPDATE sms_failures
             SET resolved=true, resolved_at=NOW(), last_retry_at=NOW(),
                 failure_reason='suppressed: recipient opted out', updated_at=NOW()
             WHERE id=$1`,
            [f.id],
          ),
        );
        resolved++;
        continue;
      }

      try {
        const res = await sendSingleSms({ mobile: f.phone, message: f.message, senderId: sender });
        if (res.success) {
          await withAdminDb(async (db) => {
            if (f.sms_log_id) {
              await db.query(
                `UPDATE sms_usage_logs
                 SET status='sent', provider_msg_id=$2,
                     network_id=$3, sent_at=NOW(), failed_reason=NULL
                 WHERE id=$1`,
                [f.sms_log_id, res.messageId || null, res.networkId || null],
              );
            }
            await db.query(
              `UPDATE sms_failures
               SET resolved=true, resolved_at=NOW(),
                   retry_count=retry_count+1, last_retry_at=NOW(), updated_at=NOW()
               WHERE id=$1`,
              [f.id],
            );
          });
          resolved++;
        } else {
          await bumpRetry(f.id, f.retry_count, res.responseDescription);
          failed++;
        }
      } catch (err) {
        await bumpRetry(f.id, f.retry_count, err instanceof Error ? err.message : String(err));
        failed++;
      }
    }

    logger.info(`[sms] retryFailures: ${retried} due, ${resolved} resolved, ${failed} still failing`);
    return { retried, resolved, failed };
  },

  async listUsage(
    ctx: TenantContext,
    params: SmsUsageQueryInput,
  ): Promise<PaginatedResult<SmsUsageLog>> {
    return withDb(ctx, async (client) => {
      const { page, limit, status, from, to } = params;
      const offset = (page - 1) * limit;
      const conds: string[] = ['group_id=$1'];
      const vals: unknown[] = [ctx.groupId];
      let idx = 2;

      if (status) { conds.push(`status=$${idx++}`);               vals.push(status); }
      if (from)   { conds.push(`created_at::date>=$${idx++}`);    vals.push(from); }
      if (to)     { conds.push(`created_at::date<=$${idx++}`);    vals.push(to); }

      const where = conds.join(' AND ');
      const { rows: countRows } = await client.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM sms_usage_logs WHERE ${where}`, vals,
      );
      const total = parseInt(countRows[0].count, 10);
      const { rows } = await client.query<SmsUsageLog>(
        `SELECT * FROM sms_usage_logs WHERE ${where}
         ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
        [...vals, limit, offset],
      );
      return { items: rows, total, page, pageSize: limit, totalPages: Math.ceil(total / limit) };
    });
  },

  async isOptedOut(groupId: string, phone: string): Promise<boolean> {
    const normalized = normalizePhone(phone);
    const { rows } = await withAdminDb((db) =>
      db.query<{ opt_out_phones: string[] }>(
        `SELECT opt_out_phones FROM sms_group_settings WHERE group_id=$1`, [groupId],
      ),
    );
    return rows[0]?.opt_out_phones?.includes(normalized) ?? false;
  },

  async optOut(groupId: string, phone: string): Promise<void> {
    const normalized = normalizePhone(phone);
    await withAdminDb((db) =>
      db.query(
        `INSERT INTO sms_group_settings (group_id, opt_out_phones)
         VALUES ($1, ARRAY[$2::text])
         ON CONFLICT (group_id) DO UPDATE
           SET opt_out_phones = array_append(
             CASE WHEN $2 = ANY(sms_group_settings.opt_out_phones)
                  THEN sms_group_settings.opt_out_phones
                  ELSE sms_group_settings.opt_out_phones
             END, $2::text
           )
           WHERE NOT ($2 = ANY(sms_group_settings.opt_out_phones))`,
        [groupId, normalized],
      ),
    );
  },

  /**
   * Reverses optOut() — the missing half of the pair (SMS_MESSAGING_AUDIT_2026-08.md
   * M5). Without this, a member who opts out via the self-service preference
   * toggle has no way back in short of an officer editing the raw DB array.
   * No-op (not an error) if the row or the phone in it doesn't exist —
   * mirrors optOut()'s own "already in the desired state" tolerance.
   */
  async optIn(groupId: string, phone: string): Promise<void> {
    const normalized = normalizePhone(phone);
    await withAdminDb((db) =>
      db.query(
        `UPDATE sms_group_settings
         SET opt_out_phones = array_remove(opt_out_phones, $2::text)
         WHERE group_id = $1`,
        [groupId, normalized],
      ),
    );
  },
};

// ─── Async dispatch helper ────────────────────────────────────────────────────

/**
 * Dispatch to the provider and report which messages it accepted.
 *
 * Returns the split rather than void because the caller has to settle the
 * reservation: accepted ⇒ consume, rejected or thrown ⇒ release. Anything not
 * reported here stays 'reserved' and is picked up by the stale-reservation
 * sweeper, so a lost return value costs a delay, never a lost charge.
 */
async function dispatchBatch(
  groupId: string,
  phones: string[],
  message: string,
  logIds: string[],
): Promise<{ sentIds: string[]; failedIds: string[] }> {
  const sentIds: string[]   = [];
  const failedIds: string[] = [];

  try {
    const sender = process.env.TEXTSMS_SENDER_ID ?? 'KITABU';

    if (phones.length === 1) {
      const res = await sendSingleSms({ mobile: phones[0], message, senderId: sender });
      const status = res.success ? 'sent' : 'failed';
      await updateLogRow(logIds[0], status, res.messageId, res.networkId, res.success ? null : res.responseDescription);
      if (!res.success) {
        failedIds.push(logIds[0]);
        await logFailure(groupId, logIds[0], phones[0], message, res.responseCode, res.responseDescription);
      } else sentIds.push(logIds[0]);
    } else {
      const items: BulkSmsItem[] = phones.map((mobile, i) => ({
        mobile, message, senderId: sender, clientSmsId: i + 1,
      }));
      const result = await sendBulkSmsChunked(items);
      for (let i = 0; i < result.responses.length; i++) {
        const r = result.responses[i];
        if (!logIds[i]) continue;
        await updateLogRow(logIds[i], r.success ? 'sent' : 'failed', r.messageId, r.networkId, r.success ? null : r.responseDescription);
        if (!r.success) {
          failedIds.push(logIds[i]);
          await logFailure(groupId, logIds[i], phones[i], message, r.responseCode, r.responseDescription);
        } else sentIds.push(logIds[i]);
      }
      // A chunk that returned fewer responses than items leaves the tail
      // unaccounted for. Treat those as failed so their earmark is returned
      // rather than silently held.
      for (let i = result.responses.length; i < logIds.length; i++) failedIds.push(logIds[i]);
    }

    logger.info(`[sms] dispatched: ${sentIds.length} sent, ${failedIds.length} failed (group ${groupId})`);
  } catch (err) {
    logger.error('[sms] dispatchBatch error:', err);
    const { pool } = await import('@/lib/db');
    const client = await pool.connect();
    try {
      await client.query(
        `UPDATE sms_usage_logs SET status='failed', failed_reason=$1 WHERE id=ANY($2::uuid[])`,
        [String(err), logIds],
      );
    } finally { client.release(); }
    // The provider never confirmed acceptance, so nothing here is chargeable.
    return { sentIds: [], failedIds: logIds };
  }

  return { sentIds, failedIds };
}

async function updateLogRow(
  id: string, status: string,
  msgId: string, networkId: string, reason: string | null,
): Promise<void> {
  const { pool } = await import('@/lib/db');
  const client   = await pool.connect();
  try {
    await client.query(
      `UPDATE sms_usage_logs
       SET status=$1::sms_status, provider_msg_id=$2, network_id=$3,
           sent_at=CASE WHEN $1='sent' THEN NOW() ELSE sent_at END,
           failed_reason=$4
       WHERE id=$5`,
      [status, msgId || null, networkId || null, reason, id],
    );
  } finally { client.release(); }
}

/**
 * Record a failed retry attempt and schedule the next one with exponential
 * backoff (5, 10, 20, … minutes, capped). Once retry_count reaches max_retries
 * the row stops matching the retryFailures() query and becomes a permanent
 * failure.
 */
async function bumpRetry(id: string, retryCount: number, reason: string): Promise<void> {
  const { pool } = await import('@/lib/db');
  const client   = await pool.connect();
  try {
    await client.query(
      `UPDATE sms_failures
       SET retry_count   = retry_count + 1,
           last_retry_at = NOW(),
           next_retry_at = NOW() + (LEAST(POWER(2, retry_count)::int, 8) * INTERVAL '5 minutes'),
           failure_reason = $2,
           updated_at    = NOW()
       WHERE id = $1`,
      [id, reason],
    );
  } finally { client.release(); }
}

async function logFailure(
  groupId: string, logId: string, phone: string,
  message: string, code: number, reason: string,
): Promise<void> {
  const { pool } = await import('@/lib/db');
  const client   = await pool.connect();
  try {
    await client.query(
      `INSERT INTO sms_failures
         (group_id, sms_log_id, phone, message, failure_code, failure_reason, next_retry_at)
       VALUES ($1,$2,$3,$4,$5,$6, NOW() + INTERVAL '5 minutes')`,
      [groupId, logId, phone, message, String(code), reason],
    );
  } finally { client.release(); }
}
