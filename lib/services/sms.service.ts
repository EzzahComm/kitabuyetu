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
import { enqueue, QUEUES } from '@/lib/queue';
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

    return withTransaction(ctx, async (client) => {
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
      if (!eligible.length) return [];

      const rate       = parseFloat(billing.sms_rate);
      const totalCost  = rate * eligible.length;
      const credits    = parseFloat(billing.sms_credits);
      if (credits < totalCost) throw new InsufficientSmsCreditsError();

      await client.query(
        `UPDATE billing_accounts SET sms_credits=sms_credits-$1 WHERE group_id=$2`,
        [totalCost.toFixed(4), ctx.groupId],
      );

      const logs: SmsUsageLog[] = [];
      for (const phone of eligible) {
        const { rows } = await client.query<SmsUsageLog>(
          `INSERT INTO sms_usage_logs
             (group_id, recipient_phone, message_text, credits_deducted,
              reference_type, reference_id, provider)
           VALUES ($1,$2,$3,$4,$5,$6,'textsms') RETURNING *`,
          [ctx.groupId, phone, message, rate.toFixed(4), referenceType ?? null, referenceId ?? null],
        );
        logs.push(rows[0]);
      }

      const logIds = logs.map((l) => l.id);
      setImmediate(() => dispatchBatch(ctx.groupId, eligible, message, logIds));
      return logs;
    });
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

    // Filter opt-outs
    const optOuts = await withAdminDb(async (db) => {
      const { rows } = await db.query<{ opt_out_phones: string[] }>(
        `SELECT opt_out_phones FROM sms_group_settings WHERE group_id=$1`, [input.groupId],
      );
      return new Set(rows[0]?.opt_out_phones ?? []);
    });

    const eligible = phones.filter((p) => !optOuts.has(p));

    // Insert log rows in bulk
    const logIds: string[] = [];
    const batchSize = 200;

    await withAdminDb(async (db) => {
      for (let i = 0; i < eligible.length; i += batchSize) {
        const batch = eligible.slice(i, i + batchSize);
        for (const phone of batch) {
          const { rows } = await db.query<{ id: string }>(
            `INSERT INTO sms_usage_logs
               (group_id, recipient_phone, message_text, credits_deducted,
                reference_type, reference_id, campaign_id, provider)
             VALUES ($1,$2,$3,0,$4,$5,$6,'textsms') RETURNING id`,
            [
              input.groupId, phone, input.message,
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
    });

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
               at_message_id=$2, sent_at=NOW(),
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
               (group_id, sms_log_id, phone, message, failure_code, failure_reason)
             VALUES ($1,$2,$3,$4,$5,$6)`,
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

  async getDlr(messageId: string): Promise<{ status: string; deliveredAt?: string }> {
    const result = await getDeliveryReport(messageId);
    // Store result
    await withAdminDb(async (db) => {
      await db.query(
        `UPDATE sms_usage_logs
         SET status=$1, delivered_at=$2
         WHERE provider_msg_id=$3 OR at_message_id=$3`,
        [
          result.status === 'Delivered' ? 'delivered' : 'failed',
          result.deliveredAt ?? null,
          messageId,
        ],
      );
      await db.query(
        `INSERT INTO sms_delivery_reports
           (provider_message_id, phone, status, network_id, delivered_at, raw_response)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT DO NOTHING`,
        [
          messageId, result.phone,
          result.status, result.networkId,
          result.deliveredAt ?? null,
          JSON.stringify(result.raw),
        ],
      );
    });
    return { status: result.status, deliveredAt: result.deliveredAt };
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
       SET status=$1, provider_msg_id=$2, at_message_id=$2, network_id=$3,
           sent_at=CASE WHEN $1='sent' THEN NOW() ELSE sent_at END,
           failed_reason=$4
       WHERE id=$5`,
      [status, msgId || null, networkId || null, reason, id],
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
