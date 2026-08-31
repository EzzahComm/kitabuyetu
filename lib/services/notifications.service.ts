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
 * (system actor).
 *
 * ── Billing (Phase 2a, migration 123) ──
 * SMS sent from here goes through the same reservation primitive as every
 * other path (lib/services/messaging-billing.ts) rather than the hardcoded
 * `credits_deducted = 0` it used before. `billingMode` decides whether that
 * reservation actually charges:
 *   'unbilled' (default) — a log row is written with credits 0, exactly as
 *                          today. Every current caller keeps this behaviour;
 *                          Phase 2b flips the default once the bundled
 *                          per-plan allowance exists.
 *   'billed'             — reserve, then consume on provider acceptance.
 *   'platform'           — platform-funded (auth/OTP). Can never carry a
 *                          charge; enforced by a CHECK constraint.
 *
 * ── This function must never throw ──
 * Its callers sit between a claim and a settle in *separate* transactions
 * (reminder.service.ts), or swallow errors entirely. An escaping error strands
 * the claim as 'pending' with attempts never incremented. The whole body is
 * therefore wrapped; every failure becomes a NotifyOutcome.
 */
import { pool } from '@/lib/db';
import { logger } from '@/lib/logger';
import { sendText, isWhatsAppConfigured } from '@/lib/integrations/whatsapp-client';
import { sendSingleSms } from './textsms.service';
import { normalizePhone, isValidKenyanPhone } from '@/lib/utils/phone';
import {
  reserveCredits,
  settleReservation,
  releaseUnticketedReservation,
  raiseLowBalanceAlert,
  type ReservationTarget,
} from './messaging-billing';

/** Who pays for a notification's SMS leg. See the billing note above. */
export type NotifyBillingMode = 'unbilled' | 'billed' | 'platform';

export interface NotifyRecipient {
  groupId:  string;
  memberId: string;
  phone:    string;
  body:     string;
  /** Free-form linkage so the audit rows can be traced back to the event. */
  referenceType?: string;
  referenceId?:   string;
  /** Shown in the (member) portal's in-app notifications list. Falls back to a
   *  referenceType-derived label when omitted, so existing call sites don't
   *  need to change. */
  title?: string;
  /** Defaults to 'unbilled' — every existing caller keeps its current cost. */
  billingMode?: NotifyBillingMode;
  /** Organization to bill when billingMode is 'billed' and the org is paying. */
  payerOrganizationId?: string | null;
  /** Machine-readable message class, stamped onto the ledger row. */
  notificationType?: string;
  /** Ties every row produced by one business action together. */
  correlationId?: string | null;
}

const DEFAULT_TITLE_BY_REFERENCE: Record<string, string> = {
  loan_repayment:        'Loan reminder',
  contribution_reminder: 'Contribution reminder',
  stk_fallback:          'Payment issue',
};

function deriveTitle(rcpt: NotifyRecipient): string {
  if (rcpt.title) return rcpt.title;
  return DEFAULT_TITLE_BY_REFERENCE[rcpt.referenceType ?? ''] ?? 'Notification';
}

/**
 * Best-effort write to the in-app `notifications` table (member-notifications
 * .service.ts's read side, and the (member) portal's bell badge) alongside
 * the real WhatsApp/SMS dispatch this file already does. A single choke
 * point here organically populates the feed for every existing call site
 * (lib/jobs/handlers.ts, lib/services/mpesa-stk.service.ts) without having
 * to touch each one individually. Never throws — an in-app write failing
 * must never break the real delivery this function exists for.
 */
async function writeInAppNotification(rcpt: NotifyRecipient): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO notifications (group_id, member_id, type, title, body, reference_type, reference_id)
       VALUES ($1, $2, 'in_app', $3, $4, $5, $6)`,
      [rcpt.groupId, rcpt.memberId, deriveTitle(rcpt), rcpt.body, rcpt.referenceType ?? null, rcpt.referenceId ?? null],
    );
  } catch (err) {
    logger.error('[notifications] failed to write in-app notification row', err);
  }
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
  // Outer guard: this function must never throw (see the file header). Before
  // Phase 2a it could — sendText() below sat outside any try/catch, so a
  // throwing WhatsApp client escaped to callers that don't guard, stranding
  // reminder.service's claim row as 'pending'. That hole is closed here rather
  // than assumed away, because a credit reservation now sits downstream of it.
  try {
    return await notifyMemberInner(rcpt);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error('[notifications] notifyMember escaped', { memberId: rcpt.memberId, detail });
    return { channel: 'none', status: 'failed', detail };
  }
}

async function notifyMemberInner(rcpt: NotifyRecipient): Promise<NotifyOutcome> {
  // In-app copy is independent of SMS/WhatsApp deliverability (invalid
  // phone, opt-out, provider outage) — a member should still see it in the
  // portal even if every external channel fails or is skipped.
  await writeInAppNotification(rcpt);

  if (!isValidKenyanPhone(rcpt.phone)) {
    return { channel: 'none', status: 'failed', detail: 'invalid phone' };
  }
  const phone = normalizePhone(rcpt.phone);

  // ── Consent gate ─────────────────────────────────────────────────────
  // Suppress on either channel if the number opted out. This is a
  // compliance requirement, not a delivery failure, so it is reported as
  // 'suppressed' and not counted against the failure tally. It runs BEFORE
  // any reservation, so a suppressed send costs nothing.
  if (await isPhoneOptedOut(rcpt.groupId, phone)) {
    return { channel: 'none', status: 'suppressed', detail: 'recipient opted out' };
  }

  // ── WhatsApp attempt ─────────────────────────────────────────────────
  // Nothing is reserved here: a WhatsApp-delivered message consumes no SMS
  // credit, which is why the reservation lives in the fallback below rather
  // than at the top of this function.
  if (isWhatsAppConfigured()) {
    try {
      const wa = await sendText({ to: phone, body: rcpt.body });
      if (wa.status === 'sent') {
        await writeWhatsAppLog(rcpt, phone, 'sent', wa.waMessageId);
        return { channel: 'whatsapp', status: 'sent' };
      }
      await writeWhatsAppLog(
        rcpt,
        phone,
        'failed',
        undefined,
        wa.status === 'failed' ? wa.errorCode    : undefined,
        wa.status === 'failed' ? wa.errorMessage : undefined,
      );
      logger.warn('[notifications] WA failed, falling back to SMS', { memberId: rcpt.memberId, detail: wa });
    } catch (err) {
      // A throwing WA client must degrade to SMS, not abort the send.
      logger.warn('[notifications] WA threw, falling back to SMS', {
        memberId: rcpt.memberId,
        detail:   err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    // WA unconfigured: write a dry_run audit row so ops sees the message
    // is being routed to SMS, not silently swallowed.
    await writeWhatsAppLog(rcpt, phone, 'dry_run', undefined, 'NOT_CONFIGURED', 'WhatsApp credentials not set');
  }

  return sendSmsLeg(rcpt, phone);
}

/**
 * The SMS fallback: reserve → write the log row → send → settle.
 *
 * Two deliberate departures from the pre-Phase-2a behaviour:
 *
 *  1. The log row is written BEFORE the provider call, not after. Previously a
 *     crash mid-dispatch lost the message entirely — no row, no trace, credits
 *     unaccounted. Write-before-send is what makes the reservation recoverable
 *     and matches what smsService.send() already did.
 *  2. Settlement is in a `finally`, so no path can leave an earmark held. The
 *     one case a finally cannot cover — the process dying outright — is the
 *     reason sms_release_stale_reservations exists.
 */
async function sendSmsLeg(rcpt: NotifyRecipient, phone: string): Promise<NotifyOutcome> {
  const mode   = rcpt.billingMode ?? 'unbilled';
  const target = billingTarget(rcpt, mode);

  let reservedCredits = 0;
  let fromAllowance   = 0;
  // Kept separately from reservedCredits (their sum) so an earmark can be
  // handed back on the exact two axes reserve_sms_credits moved.
  let reservedFromPaid   = 0;
  let reservedFromBundle = 0;
  if (mode === 'billed') {
    const reservation = await reserveCredits(pool, target, 1);
    if (!reservation.ok) {
      if (reservation.reason === 'insufficient_credits') {
        void raiseLowBalanceAlert(target);
      }
      // An operator halt and a daily cap are the reservation failures that are
      // TEMPORARY (the cap lifts at Kenyan midnight), so they must stay
      // resumable. reminder_dispatch_log treats 'suppressed' as
      // terminal and never re-claims it (see reminder.service.ts's claim()),
      // which would mean every reminder that came due during a halt is lost
      // for good once the halt lifts. 'failed' is resumable, so the next tick
      // after the switch flips back picks it up.
      if (reservation.reason === 'dispatch_halted' || reservation.reason === 'daily_limit_reached') {
        return { channel: 'sms', status: 'failed', detail: reservation.reason };
      }
      // Terminal suppression, not a failure: reminder_dispatch_log treats
      // 'failed' as retryable, so reporting this as failed would re-attempt
      // the same unaffordable send on every cron tick forever.
      return { channel: 'sms', status: 'suppressed', detail: reservation.reason };
    }
    // Migration 144: credits are MESSAGE COUNTS, so this is fromPaid +
    // fromAllowance, not `total`. `total` is the notional MONEY cost
    // (rate * count) and using it here mixed units inside a single row:
    // settle computes paid = credits_reserved - credits_from_allowance, so a
    // 0.90 reserved against a 1 allowance gave -0.10 and GREW the balance on
    // consume. The unit mismatch this migration closes had a second head.
    reservedCredits    = reservation.fromPaid + reservation.fromAllowance;
    reservedFromPaid   = reservation.fromPaid;
    reservedFromBundle = reservation.fromAllowanceCount;
    // Phase 2b (migration 124): this is always a single-message reservation
    // (count=1 above), so fromAllowance is all-or-nothing — either 0 or the
    // full reservedCredits.
    fromAllowance   = reservation.fromAllowance;
  }

  const logId = await insertSmsLog(rcpt, phone, mode, reservedCredits, fromAllowance);

  // No ticket row means the finally-block below can never settle, and the
  // stale-reservation sweeper cannot find it either — it scans sms_usage_logs.
  // The earmark would sit on the account forever, invisibly reducing what the
  // group can spend. Hand it back now, before the send, since an unrecordable
  // message is also one we cannot prove in order to charge for it.
  //
  // The send still proceeds: delivering a reminder matters more than auditing
  // it, which is the original and deliberate choice here. Only the money is
  // corrected.
  if (mode === 'billed' && !logId) {
    await releaseUnticketedReservation(target, reservedFromPaid, reservedFromBundle);
  }

  let settleAs: 'consume' | 'release' = 'release';

  try {
    const sms = await sendSingleSms({ mobile: phone, message: rcpt.body });
    const ok  = sms.success;
    settleAs  = ok ? 'consume' : 'release';

    await finaliseSmsLog(logId, ok ? 'sent' : 'failed', sms.messageId, sms.networkId,
                         ok ? null : sms.responseDescription);

    return ok
      ? { channel: 'sms', status: 'sent' }
      : { channel: 'sms', status: 'failed', detail: sms.responseDescription };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await finaliseSmsLog(logId, 'failed', null, null, detail);
    return { channel: 'sms', status: 'failed', detail };
  } finally {
    if (mode === 'billed' && logId) {
      await settleReservation([logId], settleAs);
    }
  }
}

function billingTarget(rcpt: NotifyRecipient, mode: NotifyBillingMode): ReservationTarget {
  if (mode === 'platform') return { payerType: 'platform', groupId: null };
  return rcpt.payerOrganizationId
    ? { payerType: 'organization', groupId: rcpt.groupId, organizationId: rcpt.payerOrganizationId }
    : { payerType: 'group', groupId: rcpt.groupId };
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

/**
 * Write the ledger row BEFORE the provider is called, in 'queued' state.
 *
 * Returns the row id so the send can be finalised and its reservation settled.
 * Returns null if the write fails — the send still proceeds, because
 * delivering the message matters more than auditing it.
 *
 * It used to say here that "an unsettled reservation is what the sweeper
 * exists to recover". That was false: the sweeper
 * (sms_release_stale_reservations) works from sms_usage_logs rows, so with no
 * row written there is nothing for it to find and the earmark was permanent.
 * The caller now compensates explicitly via releaseUnticketedReservation.
 */
async function insertSmsLog(
  rcpt:    NotifyRecipient,
  toPhone: string,
  mode:    NotifyBillingMode,
  reserved: number,
  fromAllowance: number = 0,
): Promise<string | null> {
  const isPlatform = mode === 'platform';
  const payerType  = isPlatform ? 'platform'
                   : rcpt.payerOrganizationId ? 'organization' : 'group';
  try {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO sms_usage_logs (
         group_id, member_id, recipient_phone, message_text, status,
         credits_deducted, credits_reserved, credits_from_allowance, billing_state, reserved_at,
         notification_type, correlation_id,
         reference_type, reference_id, provider,
         payer_type, payer_organization_id
       ) VALUES (
         $1, $2, $3, $4, 'queued',
         0, $5, $6, $7::varchar, CASE WHEN $7 = 'reserved' THEN NOW() ELSE NULL END,
         $8, $9,
         $10, $11, 'textsms',
         $12, $13
       ) RETURNING id`,
      [
        isPlatform ? null : rcpt.groupId,
        // `|| null`, not `?? null`: sendServiceSms passes '' when it has no
        // member, and an empty string is not a valid uuid.
        rcpt.memberId || null,
        toPhone,
        rcpt.body,
        reserved.toFixed(4),
        fromAllowance.toFixed(4),
        mode === 'billed' ? 'reserved' : 'none',
        rcpt.notificationType ?? rcpt.referenceType ?? null,
        rcpt.correlationId ?? null,
        rcpt.referenceType ?? null,
        rcpt.referenceId ?? null,
        payerType,
        isPlatform ? null : (rcpt.payerOrganizationId ?? null),
      ],
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    logger.error('[notifications] failed to write SMS audit row', err);
    return null;
  }
}

/** Stamp the provider's verdict onto a row written by insertSmsLog. */
async function finaliseSmsLog(
  logId:   string | null,
  status:  'sent' | 'failed',
  providerMsgId?: string | null,
  networkId?: string | null,
  failedReason?: string | null,
): Promise<void> {
  if (!logId) return;
  try {
    await pool.query(
      `UPDATE sms_usage_logs
       SET status = $2::sms_status,
           provider_msg_id = $3,
           network_id      = $4,
           failed_reason   = $5,
           sent_at         = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END,
           updated_at      = NOW()
       WHERE id = $1`,
      [logId, status, providerMsgId || null, networkId || null, failedReason ?? null],
    );
  } catch (err) {
    logger.error('[notifications] failed to finalise SMS audit row', err);
  }
}

/**
 * Send a platform-funded service SMS — auth codes, verification, invitations.
 *
 * These previously called the provider directly, so they were invisible: no
 * ledger row, no cost attribution, nothing in the SMS Centre
 * (SMS_MESSAGING_AUDIT_2026-08.md, five-paths finding). They now write a
 * proper row like every other send.
 *
 * Deliberate differences from notifyMember:
 *  - No in-app notification. An OTP does not belong in the portal feed.
 *  - No consent gate. A security code is not marketing, and two of the three
 *    callers have no group whose opt-out list could even be consulted.
 *  - No WhatsApp. Changing the delivery channel of auth codes is out of scope.
 *  - payer_type='platform', so a CHECK constraint guarantees it can never
 *    carry a charge — a group with zero SMS credits must never be locked out
 *    of its own password reset.
 *
 * Never throws. startPasswordReset() in particular promises "always resolves
 * without error" and previously broke that promise only for phone numbers that
 * actually exist — an account-enumeration oracle, since the unguarded provider
 * call was unreachable for unknown numbers.
 */
export async function sendServiceSms(input: {
  phone:   string;
  body:    string;
  notificationType: string;
  groupId?:  string | null;
  memberId?: string | null;
  correlationId?: string | null;
}): Promise<{ sent: boolean; detail?: string }> {
  if (!isValidKenyanPhone(input.phone)) {
    return { sent: false, detail: 'invalid phone' };
  }
  const phone = normalizePhone(input.phone);

  const rcpt: NotifyRecipient = {
    groupId:  input.groupId ?? '',
    memberId: input.memberId ?? '',
    phone,
    body:     input.body,
    notificationType: input.notificationType,
    correlationId:    input.correlationId ?? null,
    referenceType:    input.notificationType,
  };

  const logId = await insertSmsLog(rcpt, phone, 'platform', 0);

  try {
    const sms = await sendSingleSms({ mobile: phone, message: input.body });
    await finaliseSmsLog(logId, sms.success ? 'sent' : 'failed', sms.messageId, sms.networkId,
                         sms.success ? null : sms.responseDescription);
    return sms.success ? { sent: true } : { sent: false, detail: sms.responseDescription };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logger.error('[notifications] service SMS failed', { notificationType: input.notificationType, detail });
    await finaliseSmsLog(logId, 'failed', null, null, detail);
    return { sent: false, detail };
  }
}
