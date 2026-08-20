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
import { env } from '@/lib/env';
import {
  sendSingleSms,
  sendBulkSmsChunked,
  getDeliveryReport,
  getProviderBalance,
  type BulkSmsItem,
  type SmsResponse,
} from './textsms.service';
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
const DLR_PENDING = /pending|scheduled|queued|accepted|submit|enroute|in.?transit|unknown/;

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

/**
 * One SMS costs one credit (migration 144, spec §6).
 *
 * Named rather than a bare `1` because the value it replaced was `rate`, and
 * the whole defect was that a rate looks equally plausible in these positions.
 * A constant makes the unit an assertion instead of an assumption: credits
 * count MESSAGES, and money only ever appears as `rate * count` for display.
 */
const CREDITS_PER_MESSAGE = 1;

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
      db.query<{ phone: string; first_name: string; last_name: string }>(
        `SELECT m.phone, m.first_name, m.last_name
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
      first_name: m.first_name,
      last_name:  m.last_name,
      full_name:  `${m.first_name} ${m.last_name}`.trim(),
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
      for (const phone of eligible) {
        const fromAllowance = allowanceLeft > 0 ? (allowanceLeft--, CREDITS_PER_MESSAGE) : 0;
        const { rows: inserted } = await client.query<SmsUsageLog>(
          `INSERT INTO sms_usage_logs
             (group_id, recipient_phone, message_text, credits_deducted, credits_reserved,
              credits_from_allowance, billing_state, reserved_at, notification_type, correlation_id,
              reference_type, reference_id, provider, payer_type, payer_organization_id)
           VALUES ($1,$2,$3,0,$4,$5,'reserved',NOW(),$6,$7,$8,$9,'textsms',$10,$11) RETURNING *`,
          [ctx.groupId, phone, message, CREDITS_PER_MESSAGE.toFixed(4), fromAllowance.toFixed(4),
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
    // A real campaign already has a stable id of its own; dispatchBatchId is
    // only consulted for ad-hoc job-triggered sends that have none.
    const dispatchKey = input.campaignId ?? input.dispatchBatchId ?? null;

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
      const { rows: settingsRows } = await db.query<{ opt_out_phones: string[] }>(
        `SELECT opt_out_phones FROM sms_group_settings WHERE group_id=$1`, [input.groupId],
      );
      const optOuts  = new Set(settingsRows[0]?.opt_out_phones ?? []);
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
      const reservation = await reserveCredits(db, toReservationTarget(input.groupId, payer), eligible.length);
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

      // Insert log rows in batches, each carrying its per-message credit cost
      for (let i = 0; i < eligible.length; i += batchSize) {
        const batch = eligible.slice(i, i + batchSize);
        for (const phone of batch) {
          // One credit per message (migration 144) — see the single-send path.
          const fromAllowance = allowanceLeft > 0 ? (allowanceLeft--, CREDITS_PER_MESSAGE) : 0;
          const { rows } = await db.query<{ id: string }>(
            `INSERT INTO sms_usage_logs
               (group_id, recipient_phone, message_text, credits_deducted, credits_reserved,
                credits_from_allowance, billing_state, reserved_at, notification_type, correlation_id,
                reference_type, reference_id, campaign_id, provider,
                payer_type, payer_organization_id)
             VALUES ($1,$2,$3,0,$4,$5,'reserved',NOW(),$6,$7,$8,$9,$10,'textsms',$11,$12) RETURNING id`,
            [
              input.groupId, phone, messageFor(phone), CREDITS_PER_MESSAGE.toFixed(4), fromAllowance.toFixed(4),
              feature,
              dispatchKey,
              feature,
              input.referenceId ?? dispatchKey,
              input.campaignId ?? null,
              payerType, payerOrgId,
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
   *
   * `limit` was 50 — one job doing up to 50 sequential outbound HTTP calls
   * could alone exceed processJobBatch's per-tick time budget (see
   * lib/jobs/processor.ts), which is exactly how sms_poll_dlr ended up stuck
   * "sent" and never "delivered" for real production messages for days:
   * the job kept getting claimed, timing out mid-poll, and getting reset by
   * the stuck-job sweep without ever finishing. Lower, and the 5-minute
   * cadence just works through the backlog incrementally instead.
   */
  async pollPendingDlrs(limit = 15): Promise<{ checked: number; delivered: number; failed: number; pending: number }> {
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
           -- Widened from 24 hours: that window silently orphaned any message
           -- the poller hadn't reached in time, which is exactly what the
           -- 2026-08-12/17 job-queue stall did to real production sends —
           -- once older than 24h they'd NEVER be checked again, stuck 'sent'
           -- forever. 7 days sweeps up that incident backlog too; the
           -- provider's own DLR data is unlikely to be meaningful much past
           -- that regardless.
           AND sent_at >= NOW() - INTERVAL '7 days'
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
    // payer_type / payer_organization_id come from the ORIGINAL log row: a
    // retry must bill whoever the first attempt was going to bill, never the
    // group by default.
    const failures = await withAdminDb((db) =>
      db.query<{
        id: string; group_id: string; sms_log_id: string | null;
        phone: string; message: string; retry_count: number;
        payer_type: string | null; payer_organization_id: string | null;
      }>(
        `SELECT f.id, f.group_id, f.sms_log_id, f.phone, f.message, f.retry_count,
                l.payer_type, l.payer_organization_id
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

      // ── Re-reserve BEFORE dispatch ──────────────────────────────────────
      // The first attempt reserved credits and RELEASED them when it failed
      // (billing_state='released'). Nothing re-reserved on retry, so a message
      // that failed once and succeeded on retry was delivered with
      // credits_deducted = 0 — free, for every tenant, silently. Confirmed on
      // real production sends 2026-08-16.
      //
      // The reservation has to happen BEFORE sendSingleSms, not after: once
      // the provider has accepted the message we can no longer decline to
      // send it, so discovering an empty balance at that point would leave us
      // having delivered something unbilled all over again. This mirrors the
      // order in send() — reserve, dispatch, then consume or release.
      const target = {
        payerType:      (f.payer_type as 'group' | 'organization' | 'platform') ?? 'group',
        groupId:        f.group_id,
        organizationId: f.payer_organization_id,
      };
      const reservation = await withAdminDb((db) =>
        reserveCredits(db, target, CREDITS_PER_MESSAGE),
      );
      if (!reservation.ok) {
        // Out of credits is not a transient provider fault — retrying on a
        // timer will not conjure a balance. Record it and stop; a top-up puts
        // the row back in play because retry_count is untouched.
        await bumpRetry(f.id, f.retry_count, `billing: ${reservation.reason} — ${reservation.detail}`);
        failed++;
        continue;
      }

      if (f.sms_log_id) {
        const fromAllowance = reservation.fromAllowanceCount > 0 ? CREDITS_PER_MESSAGE : 0;
        await withAdminDb((db) =>
          db.query(
            `UPDATE sms_usage_logs
             SET credits_reserved=$2, credits_from_allowance=$3,
                 billing_state='reserved', reserved_at=NOW()
             WHERE id=$1`,
            [f.sms_log_id, CREDITS_PER_MESSAGE.toFixed(4), fromAllowance.toFixed(4)],
          ),
        );
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
          // Provider accepted ⇒ the earmark becomes a real debit.
          if (f.sms_log_id) await settleReservation([f.sms_log_id], 'consume');
          resolved++;
        } else {
          if (f.sms_log_id) await settleReservation([f.sms_log_id], 'release');
          await bumpRetry(f.id, f.retry_count, res.responseDescription);
          failed++;
        }
      } catch (err) {
        // Release on the throw path too, or a provider timeout strands the
        // earmark until the stale-reservation sweeper reclaims it.
        if (f.sms_log_id) await settleReservation([f.sms_log_id], 'release');
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
