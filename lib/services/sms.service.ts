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
import { InsufficientSmsCreditsError, PaymentRequiredError } from '@/lib/utils/errors';
import { logger } from '@/lib/logger';
import {
  sendSingleSms,
  sendBulkSmsChunked,
  getDeliveryReport,
  getProviderBalance,
  type BulkSmsItem,
} from './textsms.service';
import { renderTemplate, renderBuiltin, type TemplateVars, type TemplateKey } from '@/lib/sms/templates';
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
}

// ─── Credit helpers ───────────────────────────────────────────────────────────

async function fetchBillingRow(client: import('pg').PoolClient, groupId: string) {
  const { rows } = await client.query<{ sms_credits: string; sms_rate: string }>(
    `SELECT ba.sms_credits, COALESCE(s.sms_rate,'0.90') AS sms_rate
     FROM billing_accounts ba
     LEFT JOIN subscriptions s ON s.group_id=ba.group_id AND s.status='active'
     WHERE ba.group_id=$1 FOR UPDATE`,
    [groupId],
  );
  return rows[0] ?? null;
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
        `SELECT phone FROM members
         WHERE group_id=$1 ${activeOnly ? "AND status='active'" : ''} AND phone IS NOT NULL`,
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
        `SELECT phone FROM members
         WHERE id=ANY($1::uuid[]) AND group_id=$2 AND phone IS NOT NULL`,
        [ids, groupId],
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
      // Active subscription guard
      const { rows: sub } = await client.query<{ status: string }>(
        `SELECT status FROM subscriptions WHERE group_id=$1 AND status='active' LIMIT 1`,
        [ctx.groupId],
      );
      if (!sub[0]) throw new PaymentRequiredError('Subscription inactive. SMS cannot be sent.');

      const billing = await fetchBillingRow(client, ctx.groupId);
      if (!billing) throw new PaymentRequiredError('No billing account found.');

      const optOuts  = await fetchOptOuts(client, ctx.groupId);
      const eligible = normalized.filter((p) => !optOuts.has(p));
      if (!eligible.length) return [] as SmsUsageLog[];

      const rate       = parseFloat(billing.sms_rate);
      const totalCost  = rate * eligible.length;
      const credits    = parseFloat(billing.sms_credits);
      if (credits < totalCost) throw new InsufficientSmsCreditsError();

      await client.query(
        `UPDATE billing_accounts SET sms_credits=sms_credits-$1 WHERE group_id=$2`,
        [totalCost.toFixed(4), ctx.groupId],
      );

      const rows: SmsUsageLog[] = [];
      for (const phone of eligible) {
        const { rows: inserted } = await client.query<SmsUsageLog>(
          `INSERT INTO sms_usage_logs
             (group_id, recipient_phone, message_text, credits_deducted,
              reference_type, reference_id, provider)
           VALUES ($1,$2,$3,$4,$5,$6,'textsms') RETURNING *`,
          [ctx.groupId, phone, message, rate.toFixed(4), referenceType ?? null, referenceId ?? null],
        );
        rows.push(inserted[0]);
      }
      return rows;
    });

    if (logs.length) {
      // recipient_phone preserves the eligible order the rows were inserted in,
      // so phones[i] ↔ logIds[i] pairing in dispatchBatch stays correct.
      await dispatchBatch(
        ctx.groupId,
        logs.map((l) => l.recipient_phone),
        message,
        logs.map((l) => l.id),
      );
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

    // Billing + log creation happen in ONE transaction so credits can never be
    // debited without the matching log rows (and vice-versa). The provider
    // dispatch below runs *outside* this transaction so we never hold a DB
    // connection open across slow HTTP calls.
    //
    // NOTE: like smsService.send(), credits are charged up-front for every
    // eligible recipient regardless of per-message outcome. Refunding credits
    // for provider-rejected sends is tracked separately (SMS-009).
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

      // Active subscription guard (mirrors send())
      const { rows: sub } = await db.query<{ status: string }>(
        `SELECT status FROM subscriptions WHERE group_id=$1 AND status='active' LIMIT 1`,
        [input.groupId],
      );
      if (!sub[0]) throw new PaymentRequiredError('Subscription inactive. SMS cannot be sent.');

      // Lock billing row, verify sufficient credits, debit
      const billing = await fetchBillingRow(db, input.groupId);
      if (!billing) throw new PaymentRequiredError('No billing account found.');

      const rate      = parseFloat(billing.sms_rate);
      const credits   = parseFloat(billing.sms_credits);
      const totalCost = rate * eligible.length;
      if (credits < totalCost) throw new InsufficientSmsCreditsError();

      await db.query(
        `UPDATE billing_accounts SET sms_credits=sms_credits-$1 WHERE group_id=$2`,
        [totalCost.toFixed(4), input.groupId],
      );

      // Insert log rows in batches, each carrying its per-message credit cost
      for (let i = 0; i < eligible.length; i += batchSize) {
        const batch = eligible.slice(i, i + batchSize);
        for (const phone of batch) {
          const { rows } = await db.query<{ id: string }>(
            `INSERT INTO sms_usage_logs
               (group_id, recipient_phone, message_text, credits_deducted,
                reference_type, reference_id, campaign_id, provider)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'textsms') RETURNING id`,
            [
              input.groupId, phone, input.message, rate.toFixed(4),
              input.referenceType ?? 'campaign',
              input.referenceId ?? input.campaignId ?? null,
              input.campaignId ?? null,
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

  async getDlr(messageId: string): Promise<{ status: DlrClass; deliveredAt?: string }> {
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
        const { status } = await this.getDlr(log.msg_id);
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
};

// ─── Async dispatch helper ────────────────────────────────────────────────────

async function dispatchBatch(
  groupId: string,
  phones: string[],
  message: string,
  logIds: string[],
): Promise<void> {
  try {
    const sender = process.env.TEXTSMS_SENDER_ID ?? 'KITABU';

    let sent = 0, failed = 0;

    if (phones.length === 1) {
      const res = await sendSingleSms({ mobile: phones[0], message, senderId: sender });
      const status = res.success ? 'sent' : 'failed';
      await updateLogRow(logIds[0], status, res.messageId, res.networkId, res.success ? null : res.responseDescription);
      if (!res.success) { failed++; await logFailure(groupId, logIds[0], phones[0], message, res.responseCode, res.responseDescription); }
      else sent++;
    } else {
      const items: BulkSmsItem[] = phones.map((mobile, i) => ({
        mobile, message, senderId: sender, clientSmsId: i + 1,
      }));
      const result = await sendBulkSmsChunked(items);
      for (let i = 0; i < result.responses.length; i++) {
        const r = result.responses[i];
        await updateLogRow(logIds[i], r.success ? 'sent' : 'failed', r.messageId, r.networkId, r.success ? null : r.responseDescription);
        if (!r.success) {
          failed++;
          await logFailure(groupId, logIds[i], phones[i], message, r.responseCode, r.responseDescription);
        } else sent++;
      }
    }

    logger.info(`[sms] dispatched: ${sent} sent, ${failed} failed (group ${groupId})`);
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
  }
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
       SET status=$1, provider_msg_id=$2, network_id=$3,
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
