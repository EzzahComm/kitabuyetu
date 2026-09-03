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
import { isUuid } from '@/lib/utils/uuid';
import { segmentsOf } from '@/lib/sms/segments';
import { tickBudgetExhausted } from '@/lib/jobs/deadline';
import { InsufficientSmsCreditsError, PaymentRequiredError, NotFoundError, ServiceUnavailableError, RateLimitedError } from '@/lib/utils/errors';
import { logger } from '@/lib/logger';
import { env } from '@/lib/env';
import {
  sendSingleSms,
  sendBulkSmsChunked,
  getDeliveryReport,
  getProviderBalance,
  activeSmsProvider,
  isProviderAvailable,
  type BulkSmsItem,
  type SmsResponse,
} from '@/lib/sms/provider';
import { renderTemplate, renderBuiltin, stripUnresolved, type TemplateVars, type TemplateKey } from '@/lib/sms/templates';
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

/** One unresolved (or resolved, if asked for) failed message. */
export interface SmsFailureRow {
  id:             string;
  phone:          string;
  message:        string;
  failure_reason: string | null;
  retry_count:    number;
  max_retries:    number;
  resolved:       boolean;
  last_retry_at:  Date | null;
  next_retry_at:  Date | null;
  created_at:     Date;
  /** True when the automatic sweep will never touch this row again. */
  exhausted:      boolean;
}

export interface SendSmsResult {
  sent:    number;
  failed:  number;
  logs:    SmsUsageLog[];
}

export type DlrClass = 'delivered' | 'failed' | 'pending';

/**
 * Recognised in-transit states. Explicit rather than implied by the fallthrough
 * so that a description we have genuinely never seen can be told apart from one
 * we deliberately treat as pending — see the warn below.
 *
 * 'scheduled' is TextSMS's own word for "accepted, queued, not yet handed to
 * the operator". It is the normal state for the first seconds of a message's
 * life, and also the state every message sat in during the 2026-08-19 provider
 * stall, which is why it must classify as pending and never as failed: the
 * message may still be delivered, and marking it failed would refund a message
 * we were charged for.
 */
const DLR_PENDING = /pending|scheduled|queued|accepted|submit|enroute|in.?transit|unknown|no dlr/;

/**
 * Map a raw provider delivery status to our domain class. Conservative by
 * design: anything not clearly terminal (in-transit, accepted, unknown,
 * numeric/blank) classifies as 'pending' so a not-yet-delivered message is
 * never marked 'failed'. Failure patterns are checked first so 'UNDELIV'
 * isn't caught by the 'deliv' substring.
 *
 * MUST be given the provider's `delivery-description` ('DeliveredToTerminal',
 * 'Scheduled', …), never its numeric `delivery-status`. That number is 32 for
 * both delivered and undelivered messages, so feeding it here matched neither
 * branch and silently classified the platform's ENTIRE message history as
 * pending (docs/audits/SMS_SYSTEM_AUDIT_2026-08-20.md C1). DlrResult.status is
 * the description; DlrResult.statusCode is the number and is diagnostic only.
 */
export function classifyDlrStatus(raw: string): DlrClass {
  const s = (raw ?? '').toLowerCase();
  if (/undeliv|fail|reject|expir|delet|invalid|error|blocked/.test(s)) return 'failed';
  if (/deliv|success|delivrd/.test(s)) return 'delivered';

  // Falling through to 'pending' is the safe answer, but a description we do
  // not recognise at all is exactly how C1 stayed invisible for months: a
  // value that means "delivered" in some dialect would be quietly parked here
  // forever. Pending is still returned — this only makes the unknown loud.
  //
  // An absent/blank status is NOT "unrecognised vocabulary" — it's a report we
  // simply haven't received yet, which is the normal state of every message
  // between send and first DLR. Warning on it would bury the real signal.
  if (s !== '' && !DLR_PENDING.test(s)) {
    logger.warn('[sms] unrecognised DLR description — treating as pending', { raw });
  }
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
  /**
   * Stable identifier for THIS dispatch attempt, used to deduplicate
   * recipients on a job-level retry (SMS_MESSAGING_AUDIT_2026-08.md H3).
   * Only meaningful when campaignId is absent — a real campaign already has
   * one (its own id), so campaignId always takes priority when both are set.
   * lib/jobs/handlers.ts's handleSmsBulkSend passes the job_queue row's own
   * id, which is stable across retries of the same job (only its `attempts`
   * counter changes).
   */
  dispatchBatchId?: string;
  /**
   * Per-recipient template variables, keyed by NORMALIZED phone (the same
   * normalizePhone() form `phones` is mapped through below, so callers must
   * not hand-build keys in another format).
   *
   * When present, `message` is rendered once per recipient instead of being
   * sent verbatim — see personalize(). Built by resolveRecipientVars() and
   * passed by lib/jobs/handlers.ts's handleSmsBulkSend, which is the single
   * chokepoint every bulk path (immediate campaign, ad-hoc /sms/bulk,
   * scheduled campaign, sms_schedules occurrence) funnels through.
   */
  varsByPhone?: Map<string, TemplateVars>;
  /**
   * Total recipient count for the campaign THIS call's `phones` is a chunk
   * of. Only set by chunked QStash dispatch (lib/jobs/handlers.ts's
   * handleSmsBulkSend — closes SMS_MESSAGING_AUDIT_2026-08.md H3, docs/
   * messaging/UNIFIED_MESSAGING_ARCHITECTURE.md Phase 3 item 10). Defaults
   * to `phones.length` — i.e. "this call is the
   * whole campaign" — which is exactly today's single-call behavior, so
   * every existing caller is unaffected.
   *
   * Threading the true total through matters because `sms_campaigns
   * .recipient_count`/`.status` are written per call: without it, a second
   * chunk's call would overwrite `recipient_count` with just its own slice's
   * size, and `status` would flip to 'completed' the moment the FIRST chunk
   * finishes rather than the last. See the recipient_count/completion
   * writes below for how this is used.
   */
  totalRecipientCount?: number;
}

// ─── Credit helpers ───────────────────────────────────────────────────────────
//
// The provider SQLSTATE constants that used to live here moved to
// lib/services/messaging-billing.ts along with debitPayer's logic — mapping
// them in one place is the point of that module.

// The old billing unit, CREDITS_PER_MESSAGE = 1, is gone (SMS-AUDIT-v3 G5).
// One credit is now one provider SEGMENT — see lib/sms/segments.ts. A flat
// credit per recipient under-billed every message longer than one segment,
// and by a factor of five for anything containing an emoji or a curly quote.
// Migration 144's separate fix (credits are a message COUNT, never money)
// still stands; this only changes what one unit counts.

/**
 * Worst-case cost of one provider round trip, used to decide whether there is
 * time for another iteration inside a job tick. Matches the 15s timeout
 * getDeliveryReport passes to axios, plus a little for the DB writes around it.
 */
const DLR_CALL_BUDGET_MS = 16_000;

/**
 * Same idea for a single retry send, whose provider timeout is 20s.
 */
const SEND_CALL_BUDGET_MS = 21_000;

/**
 * Recipient count at which a bulk send should ask "are you sure?"
 * (SMS-AUDIT-v3 T3-5 / G28).
 *
 * A threshold, not a cap — nothing here refuses a send. It marks where a
 * misfire stops being cheap: 100 recipients is roughly a whole small chama,
 * and an accidental "all members" past that is a real amount of somebody's
 * money, spent irreversibly the moment the provider accepts.
 */
const BULK_CONFIRM_THRESHOLD = 100;

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
    // 503, NOT the 402 the default arm would give: an operator halt is
    // transient, and trigger-engine.ts settles any 402 as terminally failed
    // on an append-only table. See ServiceUnavailableError's own comment.
    case 'dispatch_halted':       return new ServiceUnavailableError(detail);
    // 429, not 402, for the same reason as above: a daily cap lifts at
    // midnight, so it must not be recorded as a terminal billing failure.
    case 'daily_limit_reached':   return new RateLimitedError(detail);
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
  const { rows } = await client.query<{ phone: string }>(
    `SELECT phone FROM sms_opt_outs WHERE group_id=$1`, [groupId],
  );
  return new Set(rows.map((r) => r.phone));
}

/**
 * Recompute a campaign's sent/failed tallies from its real `sms_usage_logs`
 * rows and flip `status` to 'completed' only once every recipient has a
 * terminal outcome — i.e. `resolved_count >= recipient_count`.
 *
 * Safe to call once per single-shot send (today's only caller shape) or
 * once per chunk of a QStash-dispatched campaign (SMS_MESSAGING_AUDIT_
 * 2026-08.md H3 — see BulkCampaignInput.totalRecipientCount): each call only ever advances
 * status forward, never back, and a chunk that finishes before its
 * siblings correctly leaves status at 'sending' rather than completing the
 * campaign early. `recipient_count` itself must already reflect the true
 * total (written once, idempotently, by sendBulkCampaign's caller-count
 * write above) — see that call site's comment.
 */
async function syncCampaignCompletion(client: import('pg').PoolClient, campaignId: string): Promise<void> {
  await client.query(
    `WITH tallies AS (
       SELECT
         count(*) FILTER (WHERE status = 'sent')            AS sent_count,
         count(*) FILTER (WHERE status = 'failed')           AS failed_count,
         count(*) FILTER (WHERE status IN ('sent','failed')) AS resolved_count
       FROM sms_usage_logs WHERE campaign_id = $1
     )
     UPDATE sms_campaigns c
     SET sent_count   = t.sent_count,
         failed_count = t.failed_count,
         status       = CASE WHEN t.resolved_count >= c.recipient_count THEN 'completed' ELSE 'sending' END,
         completed_at = CASE WHEN t.resolved_count >= c.recipient_count THEN COALESCE(c.completed_at, NOW()) ELSE c.completed_at END
     FROM tallies t
     WHERE c.id = $1`,
    [campaignId],
  );
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

/**
 * Resolve the template variables a bulk send can personalize with, for one
 * group: the group-level ones (identical for every recipient) merged into a
 * per-recipient map keyed by normalized phone.
 *
 * A phone with no matching member — every `custom_phones` recipient, and any
 * member removed from the group between scheduling and sending — is simply
 * absent from the map. It still gets the group-level vars (see the merge
 * below), and its per-recipient placeholders are stripped rather than sent
 * as literal `{{first_name}}` text.
 *
 * Reads current membership at send time, exactly as resolveSmsRecipients()
 * does, so the names rendered match the recipient list that was resolved.
 */
export async function resolveRecipientVars(
  groupId: string,
  phones:  string[],
): Promise<Map<string, TemplateVars>> {
  const wanted = new Set(phones.map(normalizePhone));
  if (!wanted.size) return new Map();

  const { groupName, members } = await withAdminDb(async (db) => {
    const [{ rows: groupRows }, { rows: memberRows }] = await Promise.all([
      db.query<{ name: string }>(`SELECT name FROM groups WHERE id=$1`, [groupId]),
      db.query<{ phone: string; first_name: string; last_name: string; membership_no: string | null }>(
        // membership_no is the SHORT per-group number (NC000078), not the long
        // platform member_code — it is what a member is asked to quote, and it
        // makes {{membership_no}} usable in an ordinary campaign body, not
        // only in the trigger engine's templates.
        `SELECT m.phone, m.first_name, m.last_name, gm.membership_no
         FROM members m
         JOIN group_members gm ON gm.member_id = m.id
         WHERE gm.group_id=$1 AND m.phone IS NOT NULL AND m.phone <> ''
         ORDER BY gm.created_at ASC`,
        [groupId],
      ),
    ]);
    return { groupName: groupRows[0]?.name ?? '', members: memberRows };
  });

  const byPhone = new Map<string, TemplateVars>();
  for (const phone of wanted) {
    byPhone.set(phone, { group_name: groupName });
  }
  for (const m of members) {
    const key = normalizePhone(m.phone);
    // Only recipients of THIS send, and only the first member holding a given
    // phone — two members can share a handset (a spouse pair is common), and
    // the send is one message to that number either way. Oldest membership
    // wins, so the rendered name is stable run to run rather than dependent
    // on row order.
    if (!wanted.has(key)) continue;
    const existing = byPhone.get(key);
    if (existing?.first_name !== undefined) continue;
    byPhone.set(key, {
      ...existing,
      first_name:    m.first_name,
      last_name:     m.last_name,
      full_name:     `${m.first_name} ${m.last_name}`.trim(),
      membership_no: m.membership_no ?? undefined,
    });
  }
  return byPhone;
}

/**
 * Render one recipient's copy of a bulk message.
 *
 * The provider's bulk endpoint already carries an independent `message` per
 * `mobile` (textsms.service.ts's BulkSmsItem), so personalization costs
 * nothing at the wire level — what was missing was the phone→member mapping
 * to render against (resolveRecipientVars, above).
 *
 * A message with no `{{` at all is returned untouched. stripUnresolved()
 * collapses runs of whitespace, which would silently reflow an ordinary
 * multi-line campaign body that has nothing to render in the first place.
 */
function personalize(message: string, vars: TemplateVars | undefined): string {
  if (!message.includes('{{')) return message;
  return stripUnresolved(renderTemplate(message, vars ?? {}));
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
    const result = await withTransaction(ctx, async (client) => {
      // Opt-outs are resolved before billing so a fully-suppressed send costs
      // nothing — for either payer.
      const optOuts  = await fetchOptOuts(client, ctx.groupId);
      const eligible = normalized.filter((p) => !optOuts.has(p));
      if (!eligible.length) return { fresh: [] as SmsUsageLog[], alreadyLogged: [] as SmsUsageLog[] };

      // Already-logged recipients under this correlation key are skipped, the
      // same guard sendBulkCampaign has had since H3 — this path never got it.
      //
      // Without it there were TWO uncoordinated retry owners for one message.
      // The trigger engine re-invokes send() with the same phones on its own
      // backoff (retryOrFail), while the first attempt's failures also wrote
      // sms_failures rows that the sms_retry_failed cron re-sends five minutes
      // later. A transient provider outage therefore produced duplicate
      // DELIVERED messages and duplicate charges, not just duplicate attempts.
      //
      // Scoped to correlation_id IS NOT NULL, i.e. event-driven sends that
      // carry a referenceId. A manual send has none, and repeating one is a
      // legitimate act that must stay possible.
      //
      // Rows for skipped recipients are returned alongside the new ones rather
      // than dropped: callers read status off the result (trigger-engine
      // decides retry-vs-settle from it), so hiding them would report a
      // deduped retry as "all recipients opted out" and settle it terminally
      // on an append-only table.
      let alreadyLogged: SmsUsageLog[] = [];
      if (referenceId) {
        const { rows } = await client.query<SmsUsageLog>(
          `SELECT * FROM sms_usage_logs
            WHERE group_id=$1 AND correlation_id=$2 AND recipient_phone = ANY($3::text[])`,
          [ctx.groupId, referenceId, eligible],
        );
        alreadyLogged = rows;
      }
      const skip    = new Set(alreadyLogged.map((r) => r.recipient_phone));
      const toSend  = eligible.filter((p) => !skip.has(p));
      if (!toSend.length) return { fresh: [] as SmsUsageLog[], alreadyLogged };

      // Reserve, don't debit. Credits are earmarked here and only become a real
      // charge once the provider accepts the message; a rejected send releases
      // them (SMS_MESSAGING_AUDIT_2026-08.md H5, migration 123).
      // Reserve SEGMENTS, not recipients. The provider bills per segment, so a
      // 300-character message to 3 people is 6 billable units, not 3
      // (SMS-AUDIT-v3 G5). One body for everyone on this path, so one count.
      const segsEach = segmentsOf(message);
      const reservation = await reserveCredits(
        client, toReservationTarget(ctx.groupId, payer), segsEach * toSend.length,
      );
      if (!reservation.ok) {
        // Reserve BEFORE inserting any row, so an unaffordable send leaves no
        // trace — an existing integration test pins exactly this ordering.
        void raiseLowBalanceAlert(toReservationTarget(ctx.groupId, payer));
        throw reserveFailureToError(reservation.reason, reservation.detail);
      }
      const [payerType, payerOrgId] = payerCols(payer);

      // Phase 2b: the reservation already split this batch between the
      // bundled allowance and paid credits (migration 124) — spend the
      // allowance count down per row so each row records its own true
      // source. One row is one message, so the split is all-or-nothing per
      // row: a message is never half-allowance/half-paid.
      //
      // Migration 144: each row is worth ONE CREDIT, not `rate`. The balance is
      // a message count (the top-up path credits amount_paid / rate), so
      // recording money here debited a message-count balance in money and let a
      // customer send more messages than they actually bought.
      let allowanceLeft = reservation.fromAllowanceCount;

      const rows: SmsUsageLog[] = [];
      // Recorded per-row, not hardcoded: retryFailures() reads this column
      // back to route a retry through the SAME provider that accepted the
      // original send (SMS-AUDIT-v3 T3-3), which only means something if the
      // row records the provider actually in use rather than a fixed string.
      const provider = activeSmsProvider();
      for (const phone of toSend) {
        // Allowance can part-fund a multi-segment message, so this is a
        // min() rather than the all-or-nothing it was when a row was always
        // worth exactly one credit. The CHECK requires
        // credits_from_allowance <= credits_reserved.
        const fromAllowance = Math.min(allowanceLeft, segsEach);
        allowanceLeft -= fromAllowance;
        const { rows: inserted } = await client.query<SmsUsageLog>(
          `INSERT INTO sms_usage_logs
             (group_id, recipient_phone, message_text, credits_deducted, credits_reserved,
              credits_from_allowance, billing_state, reserved_at, notification_type, correlation_id,
              reference_type, reference_id, provider, payer_type, payer_organization_id, segments)
           VALUES ($1,$2,$3,0,$4,$5,'reserved',NOW(),$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
          [ctx.groupId, phone, message, segsEach.toFixed(4), fromAllowance.toFixed(4),
           referenceType ?? null, referenceId ?? null,
           referenceType ?? null, referenceId ?? null, provider, payerType, payerOrgId, segsEach],
        );
        rows.push(inserted[0]);
      }
      // `fresh` is what may be dispatched; `alreadyLogged` must NOT be, or the
      // dedup above would have prevented the duplicate ROW while still causing
      // the duplicate MESSAGE.
      return { fresh: rows, alreadyLogged };
    });

    let logs = [...result.alreadyLogged, ...result.fresh];

    if (result.fresh.length) {
      // recipient_phone preserves the eligible order the rows were inserted in,
      // so phones[i] ↔ logIds[i] pairing in dispatchBatch stays correct.
      const { sentIds, failedIds } = await dispatchBatch(
        ctx.groupId,
        result.fresh.map((l) => l.recipient_phone),
        message,
        result.fresh.map((l) => l.id),
      );
      // Provider accepted ⇒ charge. Provider rejected or the batch threw ⇒
      // return the earmark. A later DLR-driven failure must NOT refund: the
      // provider accepted and billed us for that one.
      await settleReservation(sentIds, 'consume');
      await settleReservation(failedIds, 'release');

      // Re-read what dispatch actually recorded. The rows returned by the
      // INSERT above carry status 'queued' — the column default — because
      // dispatchBatch writes the provider's verdict to the DATABASE and never
      // touches these in-memory objects. Returning them unrefreshed reported
      // every send as 'queued' no matter what happened.
      //
      // That is not cosmetic. lib/sms/trigger-engine.ts decides whether an
      // execution is 'sent' or must be retried with
      // `!logs.some((l) => l.status !== 'failed')`, and against stale rows
      // that test can never be true: 'queued' !== 'failed' for every row, so
      // the retry branch was unreachable and an execution was marked 'sent'
      // even when the provider rejected every recipient. That is precisely
      // the defect PR #124 set out to fix — the guard it added was correct
      // but was reading data that could never show a failure.
      // sms_trigger_executions is append-only, so a wrongly-terminal row can
      // never be corrected.
      const { rows: refreshed } = await withAdminDb((db) =>
        db.query<SmsUsageLog>(
          `SELECT * FROM sms_usage_logs WHERE id = ANY($1::uuid[])`,
          [result.fresh.map((l) => l.id)],
        ),
      );
      const byId = new Map(refreshed.map((r) => [r.id, r]));
      logs = [
        ...result.alreadyLogged,
        ...result.fresh.map((l) => byId.get(l.id) ?? l),
      ];
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
    // A real campaign already has a stable id of its own; dispatchBatchId is
    // only consulted for ad-hoc job-triggered sends that have none.
    const dispatchKey = input.campaignId ?? input.dispatchBatchId ?? null;

    // dispatchKey is bound to sms_usage_logs.correlation_id and .reference_id,
    // both `uuid`. A non-uuid used to reach Postgres and fail there with 22P02
    // — on the dedup SELECT below, i.e. AFTER the caller had already been told
    // the send was queued, so every chunked bulk send failed silently and
    // wrote nothing. Fail loudly at the boundary instead: this is a caller
    // bug, never a runtime condition, and it must not look like a send that
    // merely reached no one.
    if (dispatchKey !== null && !isUuid(dispatchKey)) {
      throw new Error(
        `sendBulkCampaign: dispatchKey must be a UUID (got "${dispatchKey}") — ` +
        'it is persisted to sms_usage_logs.correlation_id/.reference_id, both uuid columns',
      );
    }

    // One rendered copy per recipient, computed once and reused by BOTH the
    // sms_usage_logs insert and the provider items below — message_text must
    // record what that number actually received, not the unrendered template.
    // Memoized rather than rendered twice because a large campaign resolves
    // to the same string for every recipient sharing a first name.
    const rendered = new Map<string, string>();
    const messageFor = (phone: string): string => {
      let text = rendered.get(phone);
      if (text === undefined) {
        text = personalize(input.message, input.varsByPhone?.get(phone));
        rendered.set(phone, text);
      }
      return text;
    };

    // Reservation + log creation happen in ONE transaction so credits can never
    // be earmarked without the matching log rows (and vice-versa). The provider
    // dispatch below runs *outside* this transaction so we never hold a DB
    // connection open across slow HTTP calls.
    //
    // Credits are reserved, not charged, for every eligible recipient; the
    // per-response settle below converts accepted messages into a real debit
    // and returns the earmark for rejected ones (closes SMS-009).
    const batchSize = 200;
    const { eligible, logIds, dedupedAway } = await withAdminDb(async (db) => {
      // Opt-out suppression
      const { rows: optOutRows } = await db.query<{ phone: string }>(
        `SELECT phone FROM sms_opt_outs WHERE group_id=$1`, [input.groupId],
      );
      const optOuts  = new Set(optOutRows.map((r) => r.phone));
      let eligible = phones.filter((p) => !optOuts.has(p));

      // H3 (SMS_MESSAGING_AUDIT_2026-08.md) — a job-level retry (e.g. after
      // resetStuckJobs reclaims a timed-out job) re-invokes this with the
      // SAME full phone list. Recipients already logged under this dispatch
      // key — whether their first attempt was accepted or rejected — must
      // not be billed or dispatched a second time; a rejected message's own
      // retry goes through sms_failures' dedicated backoff (retryFailures()),
      // not a wholesale re-run of the batch that created it.
      let dedupedAway = 0;
      if (dispatchKey) {
        const { rows: already } = await db.query<{ recipient_phone: string }>(
          `SELECT recipient_phone FROM sms_usage_logs WHERE group_id=$1 AND correlation_id=$2`,
          [input.groupId, dispatchKey],
        );
        if (already.length) {
          const alreadyLogged = new Set(already.map((r) => r.recipient_phone));
          const before = eligible.length;
          eligible = eligible.filter((p) => !alreadyLogged.has(p));
          dedupedAway = before - eligible.length;
        }
      }

      const logIds: string[] = [];
      if (!eligible.length) return { eligible, logIds, dedupedAway };

      // Reserve against the stated payer: the group, or the organization
      // running the campaign. Mirrors send()'s guards for each path.
      // Personalisation means each recipient's rendered body can differ in
      // length, so segments are summed per recipient rather than multiplied —
      // one member's name pushing their copy over 160 characters must cost
      // what it actually costs (SMS-AUDIT-v3 G5).
      const segsByPhone = new Map(eligible.map((p) => [p, segmentsOf(messageFor(p))]));
      const totalSegments = [...segsByPhone.values()].reduce((a, b) => a + b, 0);
      const reservation = await reserveCredits(db, toReservationTarget(input.groupId, payer), totalSegments);
      if (!reservation.ok) {
        void raiseLowBalanceAlert(toReservationTarget(input.groupId, payer));
        throw reserveFailureToError(reservation.reason, reservation.detail);
      }
      const [payerType, payerOrgId] = payerCols(payer);

      // Phase 2b: spend the allowance count down per row (migration 124) —
      // one row is one message, so the split is all-or-nothing per row.
      let allowanceLeft = reservation.fromAllowanceCount;

      /**
       * What feature spent these credits. One value, written to both columns,
       * exactly as the single-send path above does it.
       *
       * `notification_type` used to be the hardcoded literal 'campaign' while
       * the very next column carried the real category — so every scheduled
       * reminder, the highest-volume path in the product and the whole of Chama
       * Reminder's mechanism, landed in the analytics screen's per-feature
       * breakdown under one uninformative label. The rows were not missing,
       * which is why nothing looked wrong: they were all present, all saying
       * the same useless thing.
       *
       * Campaigns pass no referenceType and keep falling back to 'campaign',
       * which is what they are — and they stay separately attributed by
       * campaign id regardless.
       * See docs/audits/PRODUCT_CONCORDANCE_AUDIT_2026-08.md §2.5.
       */
      const feature = input.referenceType ?? 'campaign';
      // See send()'s identical comment above: recorded per-row so
      // retryFailures() can honour the provider a message actually went out
      // through, not a fixed string.
      const provider = activeSmsProvider();

      // Insert log rows in batches, each carrying its per-message credit cost
      for (let i = 0; i < eligible.length; i += batchSize) {
        const batch = eligible.slice(i, i + batchSize);
        for (const phone of batch) {
          // One credit per SEGMENT (SMS-AUDIT-v3 G5), and the allowance can
          // part-fund a multi-segment message — see the single-send path.
          const segs = segsByPhone.get(phone) ?? 1;
          const fromAllowance = Math.min(allowanceLeft, segs);
          allowanceLeft -= fromAllowance;
          const { rows } = await db.query<{ id: string }>(
            `INSERT INTO sms_usage_logs
               (group_id, recipient_phone, message_text, credits_deducted, credits_reserved,
                credits_from_allowance, billing_state, reserved_at, notification_type, correlation_id,
                reference_type, reference_id, campaign_id, provider,
                payer_type, payer_organization_id, segments)
             VALUES ($1,$2,$3,0,$4,$5,'reserved',NOW(),$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
            [
              input.groupId, phone, messageFor(phone), segs.toFixed(4), fromAllowance.toFixed(4),
              feature,
              dispatchKey,
              feature,
              input.referenceId ?? dispatchKey,
              input.campaignId ?? null,
              provider,
              payerType, payerOrgId, segs,
            ],
          );
          logIds.push(rows[0].id);
        }
      }

      if (input.campaignId) {
        // recipient_count is the campaign's TOTAL, not this call's slice —
        // see totalRecipientCount's doc comment. Every chunk of the same
        // campaign writes the same value, so this is idempotent regardless
        // of call order or how many chunks there are.
        await db.query(
          `UPDATE sms_campaigns SET status='sending', started_at=COALESCE(started_at, NOW()),
           recipient_count=$1 WHERE id=$2`,
          [input.totalRecipientCount ?? eligible.length, input.campaignId],
        );
      }

      return { eligible, logIds, dedupedAway };
    });

    // Nothing left to send — either everyone opted out, or (H3) this is a
    // job-level retry that found every recipient already logged under this
    // dispatch key. In the latter case an earlier attempt may have crashed
    // between dispatching and marking the campaign complete; finish that now
    // rather than leaving it stuck 'sending' forever, since nothing else
    // will ever revisit it once this job stops retrying.
    if (!eligible.length) {
      // Only re-syncs when THIS call's own dedup actually matched something
      // (dedupedAway > 0) — an empty chunk with nothing to dedupe against
      // (e.g. every one of its recipients opted out) has no evidence any
      // other chunk finished, so it must not touch the campaign row.
      // syncCampaignCompletion itself decides completion from the real
      // aggregate against recipient_count, not from this call in isolation.
      if (dedupedAway > 0 && input.campaignId) {
        await withAdminDb((db) => syncCampaignCompletion(db, input.campaignId!));
      }
      return { sent: 0, failed: 0, logs: [] };
    }

    // Dispatch via TextSMS bulk endpoint
    const items: BulkSmsItem[] = eligible.map((mobile, idx) => ({
      mobile,
      message:   messageFor(mobile),
      senderId:  input.senderId,
      timeToSend: input.timeToSend,
      clientSmsId: idx + 1,
    }));
    // Built before the dispatch call (not after, as before) so the catch
    // block below can attribute a thrown exception's rows back to phones too.
    const phoneByLogId = new Map(logIds.map((id, i) => [id, eligible[i]]));

    let result: Awaited<ReturnType<typeof sendBulkSmsChunked>>;
    try {
      result = await sendBulkSmsChunked(items);
    } catch (err) {
      // The provider call never answered at all (network error, timeout, DNS
      // failure) — distinct from a provider *rejection*, which
      // sendBulkSmsChunked already resolves per-item without throwing.
      // Previously uncaught here: the exception propagated out of
      // sendBulkCampaign entirely, leaving every row in this batch at its
      // INSERT default (status='queued', billing_state='reserved') — no
      // sms_failures row, invisible to retryFailures(), and recoverable only
      // ~15 minutes later when the stale-reservation sweeper released the
      // credits without ever retrying the send itself
      // (SMS_MESSAGING_AUDIT_2026-08.md H5's surviving half — the refund half
      // is already covered by the reservation model, see settleReservation
      // below and messaging-billing.ts's header comment).
      logger.error('[sms] sendBulkCampaign dispatch error:', err);
      const reason = err instanceof Error ? err.message : String(err);

      await withAdminDb(async (db) => {
        await db.query(
          `UPDATE sms_usage_logs SET status='failed', failed_reason=$1 WHERE id=ANY($2::uuid[])`,
          [reason, logIds],
        );
        for (const logId of logIds) {
          await db.query(
            `INSERT INTO sms_failures
               (group_id, sms_log_id, phone, message, failure_code, failure_reason, next_retry_at)
             VALUES ($1,$2,$3,$4,$5,$6, NOW() + INTERVAL '5 minutes')`,
            // -1: sentinel failure_code — there is no provider response to
            // report, only a local/network exception.
            [input.groupId, logId, phoneByLogId.get(logId)!, input.message, '-1', reason],
          );
        }
        if (input.campaignId) {
          await syncCampaignCompletion(db, input.campaignId);
        }
      });

      // Nothing here is chargeable — return every reservation in this batch.
      await settleReservation(logIds, 'release');
      return { sent: 0, failed: logIds.length, logs: [] };
    }

    // Align responses back to log rows by clientSmsId, not array position
    // (SMS_MESSAGING_AUDIT_2026-08.md H6) — see alignBulkResponses's own
    // comment for why positional indexing across chunked sends is unsafe.
    const byLogId = alignBulkResponses(result.responses, logIds);

    // Update log rows with provider response
    await withAdminDb(async (db) => {
      for (const logId of logIds) {
        const r = byLogId.get(logId);
        if (!r) continue; // unmatched — handled as a rejection below, same as before
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
            logId,
          ],
        );
      }

      // Aggregated from the real rows, not result.sent/result.failed (this
      // call's own batch only) — a partially-deduped retry (H3), or one
      // chunk of a QStash-dispatched campaign, would otherwise
      // overwrite the campaign's totals with just its own recipients'
      // counts, losing every other call's already-sent tally. status only
      // flips to 'completed' once the aggregate covers recipient_count —
      // see syncCampaignCompletion's own comment.
      if (input.campaignId) {
        await syncCampaignCompletion(db, input.campaignId);
      }
    });

    // Settle the reservation per response: accepted ⇒ charge, rejected ⇒ return
    // the earmark. A row the provider never answered is treated as rejected
    // (not left 'reserved') — this function's own pre-existing choice, kept
    // unchanged; only WHICH rows count as unanswered is now correct.
    const acceptedIds: string[] = [];
    const rejectedIds: string[] = [];
    for (const logId of logIds) {
      const r = byLogId.get(logId);
      if (!r)              rejectedIds.push(logId);
      else if (r.success)  acceptedIds.push(logId);
      else                 rejectedIds.push(logId);
    }
    await settleReservation(acceptedIds, 'consume');
    await settleReservation(rejectedIds, 'release');

    // Log failures for retry
    for (const logId of logIds) {
      const r = byLogId.get(logId);
      if (r && !r.success) {
        await withAdminDb((db) =>
          db.query(
            `INSERT INTO sms_failures
               (group_id, sms_log_id, phone, message, failure_code, failure_reason, next_retry_at)
             VALUES ($1,$2,$3,$4,$5,$6, NOW() + INTERVAL '5 minutes')`,
            [
              input.groupId, logId, phoneByLogId.get(logId)!,
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

  /**
   * A group's SMS position: PURCHASED credits and the plan's BUNDLED
   * allowance, which are two different pools and were previously conflated.
   *
   * Only `credits` (purchased top-ups) used to be returned, so a group that
   * had just paid for a plan including 50 messages saw a balance of 0 and
   * reasonably concluded its package came with nothing. The allowance is
   * real — reserve_sms_credits draws from it first — it simply had no way to
   * reach the UI. Reported in production right after a Starter purchase.
   */
  async getBalance(ctx: TenantContext): Promise<{
    credits: string; rate: string;
    allowanceIncluded: number; allowanceUsed: number; allowanceRemaining: number;
  }> {
    return withDb(ctx, async (client) => {
      const { rows } = await client.query<{
        sms_credits: string; sms_rate: string;
        allowance_included: number; allowance_used: number;
      }>(
        // SUM the allowance across active subscriptions, matching what
        // reserve_sms_credits itself does for a group holding more than one
        // product — taking a single row would under-report a group with both.
        `SELECT ba.sms_credits,
                COALESCE(MIN(s.sms_rate)::text,'0.90')            AS sms_rate,
                COALESCE(SUM(s.sms_allowance_included), 0)::int   AS allowance_included,
                COALESCE(MAX(ba.sms_allowance_used), 0)::int      AS allowance_used
         FROM billing_accounts ba
         LEFT JOIN subscriptions s ON s.group_id=ba.group_id AND s.status='active'
         WHERE ba.group_id=$1
         GROUP BY ba.sms_credits`,
        [ctx.groupId],
      );
      if (!rows[0]) {
        return { credits: '0.00', rate: '0.90', allowanceIncluded: 0, allowanceUsed: 0, allowanceRemaining: 0 };
      }
      const included = rows[0].allowance_included;
      const used     = rows[0].allowance_used;
      return {
        credits: rows[0].sms_credits,
        rate:    rows[0].sms_rate,
        allowanceIncluded:  included,
        allowanceUsed:      used,
        allowanceRemaining: Math.max(included - used, 0),
      };
    });
  },

  async getProviderBalance(memberId: string): Promise<{ balance: number; currency: string }> {
    const result = await getProviderBalance();
    // Snapshot to DB for history
    await withAdminDb((db) =>
      db.query(
        `INSERT INTO sms_provider_balances (provider, balance, currency, queried_by, raw_response)
         VALUES ($1,$2,$3,$4,$5)`,
        [activeSmsProvider(), result.balance, result.currency, memberId, JSON.stringify(result.raw)],
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
               queried_at   = NOW(),
               -- Drives the back-off above. Without this every row stays at 0
               -- and the ordering degenerates back to "oldest first forever".
               poll_count   = sms_delivery_reports.poll_count + 1`,
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
   *
   * `limit` was 50 — one job doing up to 50 sequential outbound HTTP calls
   * could alone exceed processJobBatch's per-tick time budget (see
   * lib/jobs/processor.ts), which is exactly how sms_poll_dlr ended up stuck
   * "sent" and never "delivered" for real production messages for days:
   * the job kept getting claimed, timing out mid-poll, and getting reset by
   * the stuck-job sweep without ever finishing. Lower, and the 5-minute
   * cadence just works through the backlog incrementally instead.
   */
  /**
   * `limit` raised 15 -> 100. The old value was chosen when processJobBatch's
   * budget was 7 seconds and one job doing 15 sequential provider calls could
   * blow it; that budget is now 50s and the loop bounds ITSELF against the
   * tick deadline (lib/jobs/deadline.ts), so the cap no longer has to stand in
   * for a time limit. At 15 per tick the platform could only ever check ~4,320
   * messages a day, which is below its own send rate.
   */
  async pollPendingDlrs(
    limit = 100,
  ): Promise<{ checked: number; delivered: number; failed: number; pending: number; abandoned: number }> {
    // ── Retire what we will never learn (SMS-REAUDIT-2026-09-02 F5) ────────
    //
    // A message that has aged past the polling window below can never be
    // asked about again, so it would otherwise sit at 'sent' forever and keep
    // the "still stuck" count climbing — which is how 151 rows accumulated
    // before migration 166 backfilled them.
    //
    // This marks the ABSENCE of knowledge, not a bad outcome: status stays
    // 'sent' because the provider genuinely accepted the message. Writing
    // 'failed' here would invent a delivery failure that was never observed
    // and corrupt every failure-rate figure derived from that column.
    //
    // Expressed as the poll query's own eligibility rules inverted, so the two
    // cannot drift apart: anything this marks is exactly what that query can
    // no longer see.
    const abandoned = await withAdminDb((db) =>
      db.query(
        `UPDATE sms_usage_logs
            SET dlr_abandoned_at = NOW()
          WHERE status = 'sent'
            AND dlr_abandoned_at IS NULL
            AND (sent_at IS NULL OR sent_at < NOW() - INTERVAL '7 days')`,
      ).then((r) => r.rowCount ?? 0),
    );
    if (abandoned > 0) {
      logger.info('[sms] delivery tracking gave up on aged messages', { abandoned });
    }

    // Every TextSMS send path (send/bulk/retry and cron reminders) records the
    // provider message id in provider_msg_id, so that single column is the basis
    // for delivery tracking.
    const logs = await withAdminDb((db) =>
      db.query<{ id: string; msg_id: string; campaign_id: string | null }>(
        // LEFT JOIN + queried_at ordering is what stops a handful of
        // never-reported messages holding every slot. sent_at ASC alone put
        // them permanently at the head of the queue, so newer messages were
        // never polled and aged out of the window still 'sent' — 175 of 353
        // lifetime rows are in exactly that state (SMS-AUDIT-v3 G3).
        //
        // The join is 1:1: sms_delivery_reports has a unique index on
        // provider_message_id.
        `SELECT l.id, l.provider_msg_id AS msg_id, l.campaign_id
         FROM sms_usage_logs l
         LEFT JOIN sms_delivery_reports dr
           ON dr.provider_message_id = l.provider_msg_id
         WHERE l.provider_msg_id IS NOT NULL
           AND l.status = 'sent'
           AND l.dlr_abandoned_at IS NULL
           AND l.sent_at IS NOT NULL
           AND l.sent_at <= NOW() - INTERVAL '2 minutes'
           -- Widened from 24 hours: that window silently orphaned any message
           -- the poller hadn't reached in time, which is exactly what the
           -- 2026-08-12/17 job-queue stall did to real production sends —
           -- once older than 24h they'd NEVER be checked again, stuck 'sent'
           -- forever. 7 days sweeps up that incident backlog too; the
           -- provider's own DLR data is unlikely to be meaningful much past
           -- that regardless.
           AND l.sent_at >= NOW() - INTERVAL '7 days'
           -- Geometric back-off on how often a message that keeps answering
           -- "no report yet" is re-asked: 5 min, 10, 20 … capped at 12 hours.
           -- Capping the exponent as well as the interval keeps POWER() from
           -- overflowing on a long-lived row.
           AND (dr.queried_at IS NULL
                OR dr.queried_at < NOW() - LEAST(
                     POWER(2, LEAST(dr.poll_count, 8)) * INTERVAL '5 minutes',
                     INTERVAL '12 hours'))
         -- Never-polled first, then least-recently-polled. Within a tie, oldest
         -- send first, preserving the previous ordering's intent.
         ORDER BY dr.queried_at ASC NULLS FIRST, l.sent_at ASC
         LIMIT $1`,
        [limit],
      ).then((r) => r.rows),
    );

    let delivered = 0, failed = 0, pending = 0;
    const touchedCampaigns = new Set<string>();

    let stoppedEarly = false;
    let checked = 0;
    for (const log of logs) {
      // One provider lookup can take up to its 15s timeout, so starting
      // another with less than that left risks the platform killing the whole
      // invocation mid-write (Vercel Hobby caps the function at 60s and
      // cannot be raised — see lib/jobs/deadline.ts). Partial progress is
      // safe: this is an idempotent sweep and the rest is picked up next tick.
      if (tickBudgetExhausted(DLR_CALL_BUDGET_MS)) {
        stoppedEarly = true;
        break;
      }
      checked++;
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

    // `checked` is what was actually polled, which is NOT logs.length when the
    // loop stopped early — reporting the selected count as the checked count
    // would hide exactly the budget pressure this bound exists to reveal.
    logger.info(
      `[sms] DLR poll: ${checked}/${logs.length} checked, ${delivered} delivered, ` +
      `${failed} failed, ${pending} pending${stoppedEarly ? ' (stopped early: tick budget)' : ''}`,
    );
    return { checked, delivered, failed, pending, abandoned };
  },

  /**
   * Retry persisted SMS failures that are due. Driven by the sms_retry_failed
   * cron job. Re-sends through the raw provider client (NOT send()) so the
   * credits already charged for the original attempt are not debited again.
   * Honours the opt-out list (a number that opted out after the original
   * attempt is resolved as suppressed rather than re-sent), and backs off
   * exponentially up to max_retries before giving up.
   */
  /**
   * `limit` lowered from 100 to 25: at a 20s provider timeout, 100 sequential
   * sends cannot fit any plausible function budget, and this runs every 5
   * minutes so the drain rate is unaffected in practice. The per-iteration
   * budget check below is the real bound; the limit just keeps the query small.
   */
  async retryFailures(limit = 25): Promise<{ retried: number; resolved: number; failed: number; skipped: number }> {
    // payer_type / payer_organization_id come from the ORIGINAL log row: a
    // retry must bill whoever the first attempt was going to bill, never the
    // group by default. `provider` too (SMS-AUDIT-v3 T3-3): a retry must go
    // out through the provider that accepted the original send, not whatever
    // is active now.
    const failures = await withAdminDb((db) =>
      db.query<{
        id: string; group_id: string; sms_log_id: string | null;
        phone: string; message: string; retry_count: number;
        payer_type: string | null; payer_organization_id: string | null;
        provider: string | null;
      }>(
        `SELECT f.id, f.group_id, f.sms_log_id, f.phone, f.message, f.retry_count,
                l.payer_type, l.payer_organization_id, l.provider
         FROM sms_failures f
         LEFT JOIN sms_usage_logs l ON l.id = f.sms_log_id
         WHERE NOT f.resolved
           AND f.retry_count < f.max_retries
           AND (f.next_retry_at IS NULL OR f.next_retry_at <= NOW())
         ORDER BY f.next_retry_at ASC NULLS FIRST
         LIMIT $1`,
        [limit],
      ).then((r) => r.rows),
    );

    // M6: read through validated env (lib/env.ts), not a second, drifted
    // 'KITABU' fallback — env.TEXTSMS_SENDER_ID's own default is the
    // registered sender ID, 'KITABU YETU'.
    const sender = env.TEXTSMS_SENDER_ID;
    let retried = 0, resolved = 0, failed = 0, skipped = 0;
    let stoppedEarly = false;

    for (const f of failures) {
      // Stop before starting a send there is no time to finish. This loop is
      // the most dangerous one to have killed mid-flight: the provider may
      // accept the message AFTER the invocation dies, so the sms_failures row
      // stays unresolved and the SAME message is sent again on the next tick —
      // a real duplicate to a real member, and a second charge. Leaving the
      // remainder for the next tick costs 5 minutes and nothing else.
      if (tickBudgetExhausted(SEND_CALL_BUDGET_MS)) {
        stoppedEarly = true;
        break;
      }

      const outcome = await retryOneFailure(f, sender);

      // A circuit skip is not an attempt: it touched no state and must not be
      // counted as one (SMS-AUDIT-v3 T3-3).
      if (outcome === 'skipped_circuit') { skipped++; continue; }

      retried++;
      if (outcome === 'resolved' || outcome === 'suppressed') resolved++;
      else failed++;
    }

    logger.info(
      `[sms] retryFailures: ${retried}/${failures.length} due, ${resolved} resolved, ` +
      `${failed} still failing, ${skipped} skipped (provider circuit open)` +
      `${stoppedEarly ? ' (stopped early: tick budget)' : ''}`,
    );
    return { retried, resolved, failed, skipped };
  },

  /**
   * What a bulk send would actually cost, before sending it
   * (SMS-AUDIT-v3 T3-5 / G28).
   *
   * An officer composing a message had no way to learn either number that
   * matters — how many people it reaches, and what it costs — until after the
   * send had happened and the credits were gone. Both are knowable up front,
   * and both have surprised people here before: "Send to All Members" once
   * silently resolved to 20 recipients, and a 200-character message costs two
   * credits per person, not one.
   *
   * Resolves the audience through the SAME resolveSmsRecipients() the send
   * path uses and prices with the SAME segmentsOf() the reservation uses — a
   * preview computed by a second implementation would eventually disagree
   * with the charge, which is worse than no preview. (Exactly the three-way
   * quoting divergence V3-01 found in the UI's own "SMS parts" counter.)
   *
   * Opt-outs are applied, so the count is who will really be messaged, not
   * who was selected. Reads only — nothing is reserved, nothing is written.
   */
  async previewBulkSend(
    ctx:   TenantContext,
    input: { message: string; phones?: string[]; recipientType?: string; rawRecipients?: unknown },
  ): Promise<{
    selected:         number;
    optedOut:         number;
    recipients:       number;
    segmentsPerMessage: number;
    creditsRequired:  number;
    balance:          { credits: number; allowanceRemaining: number; available: number };
    affordable:       boolean;
    requiresConfirmation: boolean;
  }> {
    const raw = input.phones?.length
      ? input.phones.map((p) => normalizePhone(p))
      : await resolveSmsRecipients(ctx.groupId, input.recipientType ?? '', input.rawRecipients);

    // De-duplicate first: the same number listed twice is one message, and
    // counting it twice would over-quote the cost.
    const selected = [...new Set(raw)];

    const optedOutSet = new Set(
      (await smsService.listOptOuts(ctx.groupId)).map((o) => o.phone),
    );
    const recipients  = selected.filter((p) => !optedOutSet.has(p));

    // ── Price what will ACTUALLY be sent, not what was typed ──────────
    //
    // This used to be segmentsOf(input.message) — the RAW template, complete
    // with its `{{first_name}}` placeholders. That text is never sent to
    // anybody: personalize() either substitutes the variable (`{{first_name}}`
    // is 14 characters, `Mary` is 4) or, on a send carrying no vars, STRIPS it
    // entirely. So the quoted figure was computed on a string that does not
    // exist, and it disagreed with the charge in precisely the case that costs
    // money — long values, or many of them.
    //
    // The dispatch path was always right: sendBulkCampaign prices
    // segmentsOf(messageFor(phone)) per recipient (G5). This performs the same
    // computation, through the same personalize(), against the same variables,
    // so the quote cannot drift from the invoice. A preview that disagrees
    // with the bill is the three-way divergence V3-01 was about.
    //
    // The variable lookup is skipped entirely for a message with no `{{`,
    // which is the common case and matches personalize()'s own fast path.
    const varsByPhone = input.message.includes('{{')
      ? await resolveRecipientVars(ctx.groupId, recipients)
      : undefined;

    const perRecipient = recipients.map(
      (phone) => segmentsOf(personalize(input.message, varsByPhone?.get(normalizePhone(phone)))),
    );
    const creditsRequired = perRecipient.reduce((sum, n) => sum + n, 0);
    // Personalisation makes this vary between recipients — one long name can
    // tip a single message into a second segment — so the headline figure is
    // the WORST case rather than an average that understates somebody's bill.
    const segmentsPerMessage = perRecipient.length
      ? Math.max(...perRecipient)
      : segmentsOf(personalize(input.message, undefined));

    const balance   = await smsService.getBalance(ctx);
    const credits   = Number(balance.credits);
    const available = credits + balance.allowanceRemaining;

    return {
      selected:   selected.length,
      optedOut:   selected.length - recipients.length,
      recipients: recipients.length,
      segmentsPerMessage,
      creditsRequired,
      balance: { credits, allowanceRemaining: balance.allowanceRemaining, available },
      affordable: available >= creditsRequired,
      // A threshold, not a hard cap: the caller decides how to present it.
      // Set where a mistake stops being cheap — 100 recipients is roughly a
      // whole small chama, and past that an accidental "all members" is a
      // real amount of somebody's money.
      requiresConfirmation: recipients.length >= BULK_CONFIRM_THRESHOLD,
    };
  },

  /**
   * Retry ONE failed message on an operator's say-so (SMS-AUDIT-v3 T3-5 / G22).
   *
   * Runs retryOneFailure — the same path the cron sweep uses — so the consent
   * gate, the reserve-before-dispatch ordering and the settle discipline are
   * inherited rather than re-derived. What it deliberately overrides is only
   * the SCHEDULING: `next_retry_at` and `max_retries` are ignored, because
   * waiting out a backoff (or being permanently out of attempts) is exactly
   * the situation a person clicks this button in.
   *
   * What it does NOT override:
   *  - the opt-out check. A manual retry of a number that has since opted out
   *    resolves as suppressed and spends nothing, which is the closure test.
   *  - billing. A delivered retry is charged once, through the same
   *    reservation the sweep uses. "Manual" is not a synonym for "free".
   *  - the circuit breaker. If the provider is down, a person clicking retry
   *    does not make it up.
   *
   * Group-scoped by an explicit WHERE on ctx.groupId rather than by relying on
   * sms_failures' RLS: this row drives a real spend on that group's balance,
   * so ownership is asserted here in a way that does not depend on which pool
   * the caller happens to be using.
   */
  /**
   * This group's unresolved failed messages (SMS-REAUDIT-2026-09-02 F3/F6).
   *
   * Added because `POST /sms/failures/[id]/retry` shipped with no way to
   * obtain an `[id]`: there was no GET over sms_failures anywhere, so the
   * retry action was not merely un-wired, it was undiscoverable. A capability
   * nothing can address is not a capability.
   *
   * `exhausted` is computed rather than left to the caller: it is the whole
   * reason a person needs this screen. Those rows are the ones the 5-minute
   * sweep has permanently abandoned, so a human deciding to retry is the only
   * thing that will ever move them — 7 such rows existed on the day this
   * shipped.
   *
   * Tenant pool, so RLS scopes the read; the explicit group_id predicate is
   * belt-and-braces on a table whose rows drive real spend.
   */
  async listFailures(
    ctx: TenantContext,
    params: { page: number; limit: number; includeResolved?: boolean },
  ): Promise<PaginatedResult<SmsFailureRow>> {
    return withDb(ctx, async (client) => {
      const { page, limit, includeResolved } = params;
      const offset = (page - 1) * limit;
      const where = includeResolved
        ? 'f.group_id = $1'
        : 'f.group_id = $1 AND NOT f.resolved';

      const { rows: countRows } = await client.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM sms_failures f WHERE ${where}`, [ctx.groupId],
      );
      const total = parseInt(countRows[0].count, 10);

      const { rows } = await client.query<SmsFailureRow>(
        `SELECT f.id, f.phone, f.message, f.failure_reason, f.retry_count, f.max_retries,
                f.resolved, f.last_retry_at, f.next_retry_at, f.created_at,
                (f.retry_count >= f.max_retries) AS exhausted
           FROM sms_failures f
          WHERE ${where}
          ORDER BY f.created_at DESC
          LIMIT $2 OFFSET $3`,
        [ctx.groupId, limit, offset],
      );

      return { items: rows, total, page, pageSize: limit, totalPages: Math.ceil(total / limit) };
    });
  },

  async retryFailure(
    ctx: TenantContext,
    failureId: string,
  ): Promise<{ status: RetryOutcome | 'not_found' | 'already_resolved' }> {
    const [row] = await withAdminDb((db) =>
      db.query<RetryableFailure & { resolved: boolean }>(
        `SELECT f.id, f.group_id, f.sms_log_id, f.phone, f.message, f.retry_count, f.resolved,
                l.payer_type, l.payer_organization_id, l.provider
           FROM sms_failures f
           LEFT JOIN sms_usage_logs l ON l.id = f.sms_log_id
          WHERE f.id = $1 AND f.group_id = $2`,
        [failureId, ctx.groupId],
      ).then((r) => r.rows),
    );

    if (!row)          return { status: 'not_found' };
    // Already delivered or already suppressed. Re-sending would be a duplicate
    // to a real person and a second charge — the exact pair of harms the
    // dedup work in T1-2 existed to stop.
    if (row.resolved)  return { status: 'already_resolved' };

    const outcome = await retryOneFailure(row, env.TEXTSMS_SENDER_ID);
    logger.info('[sms] manual retry', { failureId, groupId: ctx.groupId, outcome });
    return { status: outcome };
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
      db.query<{ n: string }>(
        `SELECT 1 AS n FROM sms_opt_outs WHERE group_id=$1 AND phone=$2`,
        [groupId, normalized],
      ),
    );
    return rows.length > 0;
  },

  /** Everyone currently opted out for a group, newest first. */
  async listOptOuts(groupId: string): Promise<
    { phone: string; optedOutAt: string; source: string; note: string | null }[]
  > {
    const { rows } = await withAdminDb((db) =>
      db.query<{ phone: string; opted_out_at: string; source: string; note: string | null }>(
        `SELECT phone, opted_out_at, source, note
           FROM sms_opt_outs WHERE group_id=$1 ORDER BY opted_out_at DESC`,
        [groupId],
      ),
    );
    return rows.map((r) => ({
      phone: r.phone, optedOutAt: r.opted_out_at, source: r.source, note: r.note,
    }));
  },

  /**
   * Record an opt-out. `source` says how the request reached us and `actorId`
   * who recorded it — the two things the old text[] could not hold, and the
   * two a data subject or a regulator actually asks about (DPA 2019).
   *
   * Idempotent: opting out twice keeps the FIRST timestamp, because that is
   * when consent was actually withdrawn.
   */
  async optOut(
    groupId: string,
    phone: string,
    opts: { source?: 'member' | 'officer' | 'inbound_stop'; actorId?: string | null; note?: string } = {},
  ): Promise<void> {
    const normalized = normalizePhone(phone);
    await withAdminDb((db) =>
      db.query(
        `INSERT INTO sms_opt_outs (group_id, phone, source, actor_id, note)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (group_id, phone) DO NOTHING`,
        [groupId, normalized, opts.source ?? 'member', opts.actorId ?? null, opts.note ?? null],
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
    // Deleting the row IS the opt-in: absence of a row is the consent state,
    // so a later opt-out records a fresh, truthful timestamp rather than
    // resurrecting a stale one.
    await withAdminDb((db) =>
      db.query(`DELETE FROM sms_opt_outs WHERE group_id=$1 AND phone=$2`, [groupId, normalized]),
    );
  },
};

// ─── Async dispatch helper ────────────────────────────────────────────────────

/**
 * Align a chunked bulk-send's provider responses back to the log rows that
 * requested them (SMS_MESSAGING_AUDIT_2026-08.md H6).
 *
 * The naive approach — `responses[i]` against `logIds[i]` — assumes the
 * provider returns exactly one response per item, in submission order, for
 * every 100-item chunk. If any single chunk returns fewer responses than it
 * was sent, every subsequent index shifts: the wrong log row gets marked
 * sent/failed, and sms_failures records the wrong phone.
 *
 * The request already carries a caller-assigned clientSmsId (1-based index
 * into logIds) per item specifically so the response can be matched back
 * unambiguously regardless of chunk boundaries, ordering, or drops. Prefer
 * it — but only when EVERY response in the batch carries a usable one: a
 * provider that omits it on some rows and not others is not a signal we can
 * trust row-by-row, so a partial availability falls back to the exact
 * historical positional behaviour wholesale rather than guessing which rows
 * to trust. This is strictly no worse than before when the provider never
 * echoes clientsmsid, and fixes the bug outright when it reliably does.
 *
 * Responses that end up unmatched (a dropped item, in the fallback path) are
 * simply absent from the returned map — logIds not present in it stay
 * 'reserved', which the stale-reservation sweeper already recovers.
 */
function alignBulkResponses(
  responses: SmsResponse[], logIds: string[],
): Map<string, SmsResponse> {
  const byLogId = new Map<string, SmsResponse>();
  const canUseClientId = responses.length > 0 && responses.every((r) => r.clientSmsId != null);

  if (canUseClientId) {
    for (const r of responses) {
      const logId = logIds[r.clientSmsId! - 1];
      if (logId) byLogId.set(logId, r);
    }
  } else {
    for (let i = 0; i < responses.length; i++) {
      if (logIds[i]) byLogId.set(logIds[i], responses[i]);
    }
  }
  return byLogId;
}

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
    // M6: read through validated env (lib/env.ts), not a second, drifted
    // 'KITABU' fallback — env.TEXTSMS_SENDER_ID's own default is the
    // registered sender ID, 'KITABU YETU'.
    const sender = env.TEXTSMS_SENDER_ID;

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
      const result  = await sendBulkSmsChunked(items);
      const byLogId = alignBulkResponses(result.responses, logIds);
      const phoneByLogId = new Map(logIds.map((id, i) => [id, phones[i]]));

      for (const logId of logIds) {
        const r = byLogId.get(logId);
        if (!r) continue; // unmatched — left 'reserved' for the stale-reservation sweeper
        await updateLogRow(logId, r.success ? 'sent' : 'failed', r.messageId, r.networkId, r.success ? null : r.responseDescription);
        if (!r.success) {
          failedIds.push(logId);
          await logFailure(groupId, logId, phoneByLogId.get(logId)!, message, r.responseCode, r.responseDescription);
        } else sentIds.push(logId);
      }
      // Anything the provider never answered (a genuinely dropped item, or —
      // in the positional fallback — a short chunk) stays out of both lists,
      // matching this function's own documented "stays reserved" contract.
    }

    logger.info(`[sms] dispatched: ${sentIds.length} sent, ${failedIds.length} failed (group ${groupId})`);
  } catch (err) {
    logger.error('[sms] dispatchBatch error:', err);
    const reason = err instanceof Error ? err.message : String(err);
    const { pool } = await import('@/lib/db');
    const client = await pool.connect();
    try {
      await client.query(
        `UPDATE sms_usage_logs SET status='failed', failed_reason=$1 WHERE id=ANY($2::uuid[])`,
        [reason, logIds],
      );
    } finally { client.release(); }
    // The provider never confirmed acceptance, so nothing here is chargeable —
    // the caller's settleReservation(failedIds, 'release') already returns the
    // earmark. But unlike a provider *rejection* (handled per-row above via
    // logFailure), this exception path previously wrote no sms_failures row at
    // all, so it got no retry — SMS_MESSAGING_AUDIT_2026-08.md H5's surviving
    // half (the refund half is already covered by the reservation model).
    // -1 is a sentinel failure_code: there is no provider response to report,
    // only a local/network exception.
    for (let i = 0; i < logIds.length; i++) {
      await logFailure(groupId, logIds[i], phones[i], message, -1, reason);
    }
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

export type RetryOutcome = 'resolved' | 'suppressed' | 'failed' | 'skipped_circuit';

/** The columns retryOneFailure needs, joined from sms_failures + its log row. */
interface RetryableFailure {
  id:                     string;
  group_id:               string;
  sms_log_id:             string | null;
  phone:                  string;
  message:                string;
  retry_count:            number;
  payer_type:             string | null;
  payer_organization_id:  string | null;
  provider:               string | null;
}

/**
 * Retry ONE failed message: consent gate, re-reserve, dispatch, settle.
 *
 * Extracted from retryFailures' loop so the manual retry action
 * (SMS-AUDIT-v3 T3-5 / G22) runs the identical path rather than a second
 * implementation of it. Everything delicate about this sequence was learned
 * from a production defect — the reservation ordering (a retry that delivered
 * for free, 2026-08-16), the release-on-throw (a stranded earmark), the
 * opt-out check preceding any spend — and a hand-rolled "retry" button that
 * re-derived it would eventually get one of them wrong.
 *
 * Returns an outcome rather than mutating counters, so both callers can
 * describe the result in their own terms.
 */
async function retryOneFailure(f: RetryableFailure, sender: string): Promise<RetryOutcome> {
  const provider = f.provider ?? undefined;

  // Circuit open ⇒ skip without touching retry_count/next_retry_at at all
  // (SMS-AUDIT-v3 T3-3 closure test: "an outage does not exhaust a message's
  // max_retries budget while the circuit is open"). Checked BEFORE the opt-out
  // lookup and the credit reservation below, deliberately — an outage is not
  // this row's fault, so nothing about it should change state, including work
  // that would otherwise need undoing.
  if (!isProviderAvailable(provider)) return 'skipped_circuit';

  // Consent gate — never re-send to a number that has since opted out. Ahead
  // of the reservation, so a suppressed retry costs nothing.
  if (await smsService.isOptedOut(f.group_id, f.phone)) {
    await withAdminDb((db) =>
      db.query(
        `UPDATE sms_failures
         SET resolved=true, resolved_at=NOW(), last_retry_at=NOW(),
             failure_reason='suppressed: recipient opted out', updated_at=NOW()
         WHERE id=$1`,
        [f.id],
      ),
    );
    return 'suppressed';
  }

  // ── Re-reserve BEFORE dispatch ──────────────────────────────────────
  // The first attempt reserved credits and RELEASED them when it failed
  // (billing_state='released'). Nothing re-reserved on retry, so a message
  // that failed once and succeeded on retry was delivered with
  // credits_deducted = 0 — free, for every tenant, silently. Confirmed on
  // real production sends 2026-08-16.
  //
  // The reservation has to happen BEFORE sendSingleSms, not after: once the
  // provider has accepted the message we can no longer decline to send it, so
  // discovering an empty balance at that point would leave us having delivered
  // something unbilled all over again. This mirrors the order in send() —
  // reserve, dispatch, then consume or release.
  const target = {
    payerType:      (f.payer_type as 'group' | 'organization' | 'platform') ?? 'group',
    groupId:        f.group_id,
    organizationId: f.payer_organization_id,
  };
  // Re-price from the body actually being resent. A retry must reserve what
  // the provider will bill for THIS send, not a flat 1 (G5).
  const retrySegments = segmentsOf(f.message);
  const reservation = await withAdminDb((db) =>
    reserveCredits(db, target, retrySegments),
  );
  if (!reservation.ok) {
    // Out of credits is not a transient provider fault — retrying on a timer
    // will not conjure a balance. Record it and stop; a top-up puts the row
    // back in play because retry_count is untouched.
    await bumpRetry(f.id, f.retry_count, `billing: ${reservation.reason} — ${reservation.detail}`);
    return 'failed';
  }

  if (f.sms_log_id) {
    const fromAllowance = Math.min(reservation.fromAllowanceCount, retrySegments);
    await withAdminDb((db) =>
      db.query(
        `UPDATE sms_usage_logs
         SET credits_reserved=$2, credits_from_allowance=$3, segments=$4,
             billing_state='reserved', reserved_at=NOW()
         WHERE id=$1`,
        [f.sms_log_id, retrySegments.toFixed(4), fromAllowance.toFixed(4), retrySegments],
      ),
    );
  }

  try {
    const res = await sendSingleSms({ mobile: f.phone, message: f.message, senderId: sender }, provider);
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
      // Provider accepted ⇒ the earmark becomes a real debit.
      if (f.sms_log_id) await settleReservation([f.sms_log_id], 'consume');
      return 'resolved';
    }
    if (f.sms_log_id) await settleReservation([f.sms_log_id], 'release');
    await bumpRetry(f.id, f.retry_count, res.responseDescription);
    return 'failed';
  } catch (err) {
    // Release on the throw path too, or a provider timeout strands the
    // earmark until the stale-reservation sweeper reclaims it.
    if (f.sms_log_id) await settleReservation([f.sms_log_id], 'release');
    await bumpRetry(f.id, f.retry_count, err instanceof Error ? err.message : String(err));
    return 'failed';
  }
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
