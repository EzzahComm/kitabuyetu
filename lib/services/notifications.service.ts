/**
 * Cron-driven notification helper.
 *
 * Used by job handlers (notify_loan_due_alerts, notify_contribution_reminders)
 * that operate *across* groups via withAdminDb — i.e. there is no tenant
 * context to thread through smsService / whatsappService.
 *
 * Channel policy:
 *   1. WhatsApp first when WHATSAPP_PHONE_ID + WHATSAPP_ACCESS_TOKEN are set.
 *   2. SMS (TextSMS) as fallback when WhatsApp is unconfigured, dry_run,
 *      or fails outright.
 *   3. If both fail or both are unconfigured, the row is logged and the
 *      handler moves on — never throw out of a cron handler over a single
 *      delivery failure.
 *
 * Writes audit rows to whatsapp_messages / sms_usage_logs with actor_id=null
 * (system actor). SMS sends here intentionally *bypass* billing_accounts
 * credit deduction because system reminders are a platform-level service.
 * If business policy later decides reminders should bill the group, the
 * deduction logic from smsService.send() can be wired in here.
 */
import { pool } from '@/lib/db';
import { logger } from '@/lib/logger';
import { sendText, isWhatsAppConfigured } from '@/lib/integrations/whatsapp-client';
import { sendSingleSms } from './textsms.service';
import { normalizePhone, isValidKenyanPhone } from '@/lib/utils/phone';

export interface NotifyRecipient {
  groupId:  string;
  memberId: string;
  phone:    string;
  body:     string;
  /** Free-form linkage so the audit rows can be traced back to the event. */
  referenceType?: string;
  referenceId?:   string;
}

export interface NotifyOutcome {
  channel: 'whatsapp' | 'sms' | 'none';
  status:  'sent' | 'dry_run' | 'failed' | 'suppressed';
  detail?: string;
}

/**
 * Returns true when the recipient phone is on the group's opt-out list.
 * Mirrors the suppression enforced on the tenant send paths
 * (smsService.send / sendBulkCampaign) so automated cron reminders honour
 * the same consent signal — they previously bypassed it entirely.
 */
async function isPhoneOptedOut(groupId: string, phone: string): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ opt_out_phones: string[] }>(
      `SELECT opt_out_phones FROM sms_group_settings WHERE group_id=$1`, [groupId],
    );
    return rows[0]?.opt_out_phones?.includes(phone) ?? false;
  } catch (err) {
    // Fail closed: if we can't confirm consent, don't send.
    logger.error('[notifications] opt-out lookup failed; suppressing', { groupId, err });
    return true;
  }
}

/**
 * Send one notification to one recipient. Tries WhatsApp first, falls back
 * to SMS on failure. Always writes an audit row for whichever channel was
 * actually attempted (or both if the WA attempt failed and we fell over).
 */
export async function notifyMember(rcpt: NotifyRecipient): Promise<NotifyOutcome> {
  if (!isValidKenyanPhone(rcpt.phone)) {
    return { channel: 'none', status: 'failed', detail: 'invalid phone' };
  }
  const phone = normalizePhone(rcpt.phone);

  // ── Consent gate ─────────────────────────────────────────────────────
  // Suppress on either channel if the number opted out. This is a
  // compliance requirement, not a delivery failure, so it is reported as
  // 'suppressed' and not counted against the failure tally.
  if (await isPhoneOptedOut(rcpt.groupId, phone)) {
    return { channel: 'none', status: 'suppressed', detail: 'recipient opted out' };
  }

  // ── WhatsApp attempt ─────────────────────────────────────────────────
  if (isWhatsAppConfigured()) {
    const wa = await sendText({ to: phone, body: rcpt.body });
    if (wa.status === 'sent') {
      await writeWhatsAppLog(rcpt, phone, 'sent', wa.waMessageId);
      return { channel: 'whatsapp', status: 'sent' };
    }
    // Log the failure and fall through to SMS.
    await writeWhatsAppLog(
      rcpt,
      phone,
      'failed',
      undefined,
      wa.status === 'failed' ? wa.errorCode    : undefined,
      wa.status === 'failed' ? wa.errorMessage : undefined,
    );
    logger.warn('[notifications] WA failed, falling back to SMS', { memberId: rcpt.memberId, detail: wa });
  } else {
    // WA unconfigured: write a dry_run audit row so ops sees the message
    // is being routed to SMS, not silently swallowed.
    await writeWhatsAppLog(rcpt, phone, 'dry_run', undefined, 'NOT_CONFIGURED', 'WhatsApp credentials not set');
  }

  // ── SMS fallback ─────────────────────────────────────────────────────
  try {
    const sms = await sendSingleSms({ mobile: phone, message: rcpt.body });
    const ok  = sms.success;
    await writeSmsLog(rcpt, phone, ok ? 'sent' : 'failed', sms.messageId, ok ? null : sms.responseDescription);
    return ok
      ? { channel: 'sms', status: 'sent' }
      : { channel: 'sms', status: 'failed', detail: sms.responseDescription };
  } catch (err) {
    const detail = (err as Error).message;
    await writeSmsLog(rcpt, phone, 'failed', null, detail);
    return { channel: 'sms', status: 'failed', detail };
  }
}

/**
 * Batch-send notifications. Sequential (not Promise.all) so we don't
 * stampede the Meta / TextSMS APIs; a single 8-second cron tick can
 * comfortably push ~50 messages at the typical 100ms latency, which is
 * more than enough for current group sizes. If we ever need parallelism,
 * cap concurrency with a small worker pool here.
 */
export async function notifyMany(rcpts: NotifyRecipient[]): Promise<{
  attempted:  number;
  whatsapp:   number;
  sms:        number;
  failed:     number;
  suppressed: number;
}> {
  const tally = { attempted: 0, whatsapp: 0, sms: 0, failed: 0, suppressed: 0 };
  for (const r of rcpts) {
    tally.attempted += 1;
    const out = await notifyMember(r);
    if (out.status === 'sent') {
      if (out.channel === 'whatsapp') tally.whatsapp += 1;
      else if (out.channel === 'sms') tally.sms += 1;
    } else if (out.status === 'suppressed') {
      tally.suppressed += 1;
    } else {
      tally.failed += 1;
    }
  }
  return tally;
}

// ── Audit-log writers ─────────────────────────────────────────────────

async function writeWhatsAppLog(
  rcpt:      NotifyRecipient,
  toPhone:   string,
  status:    'sent' | 'failed' | 'dry_run',
  waMessageId?: string,
  errorCode?:   string,
  errorMessage?: string,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO whatsapp_messages (
         group_id, member_id, direction, to_phone,
         message_type, body, status, wa_message_id,
         error_code, error_message,
         sent_at, failed_at
       ) VALUES (
         $1, $2, 'outbound', $3,
         'text', $4, $5::whatsapp_message_status, $6,
         $7, $8,
         CASE WHEN $5 IN ('sent', 'dry_run') THEN NOW() ELSE NULL END,
         CASE WHEN $5 = 'failed'              THEN NOW() ELSE NULL END
       )`,
      [
        rcpt.groupId, rcpt.memberId, toPhone,
        rcpt.body, status, waMessageId ?? null,
        errorCode ?? null, errorMessage ?? null,
      ],
    );
  } catch (err) {
    logger.error('[notifications] failed to write WA audit row', err);
  }
}

async function writeSmsLog(
  rcpt:    NotifyRecipient,
  toPhone: string,
  status:  'sent' | 'failed',
  providerMsgId?: string | null,
  failedReason?: string | null,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO sms_usage_logs (
         group_id, recipient_phone, message_text, status,
         provider_msg_id, credits_deducted, failed_reason,
         reference_type, reference_id, sent_at
       ) VALUES (
         $1, $2, $3, $4::sms_status,
         $5, 0, $6,
         $7, $8,
         CASE WHEN $4 = 'sent' THEN NOW() ELSE NULL END
       )`,
      [
        rcpt.groupId, toPhone, rcpt.body, status,
        providerMsgId ?? null, failedReason ?? null,
        rcpt.referenceType ?? null, rcpt.referenceId ?? null,
      ],
    );
  } catch (err) {
    logger.error('[notifications] failed to write SMS audit row', err);
  }
}
