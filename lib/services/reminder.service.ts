/**
 * Platform-wide reminder idempotency — one send per (reference, stage), no
 * matter which recurring-obligation scanner (loan due dates, missed
 * contributions, and future ones) or which channel (WhatsApp/SMS) carries it.
 *
 * Wraps notifyMember() rather than replacing it: notifyMember's WhatsApp-
 * first/SMS-fallback channel policy, opt-out gate, and in-app notification
 * row are all reused unchanged. This module owns exactly one thing — deciding
 * whether a given reminder stage has already gone out for a given reference
 * record, claimed atomically so two overlapping runs can't both send.
 *
 * Deliberately NOT used for one-off transactional sends (e.g. the STK-push
 * failure notice in mpesa-stk.service.ts) — those already fire exactly once
 * per real event and don't have a "stage" concept; forcing them through here
 * would be unnecessary friction, not a safety improvement.
 */
import { withAdminDb, withDb, type TenantContext } from '@/lib/db';
import { logger } from '@/lib/logger';
import { notifyMember, type NotifyRecipient, type NotifyOutcome } from './notifications.service';
import type { PaginatedResult } from '@/types/db.types';

export interface ReminderInput extends NotifyRecipient {
  /** Required here (optional on the underlying NotifyRecipient) — the whole
   *  point of this module is keying off a specific business record. */
  referenceType: string;
  referenceId:   string;
  /** e.g. 'due_3_days', 'overdue_7_days', 'missing_contribution:2026-06'. */
  reminderStage: string;
  /** job_queue.id of the run that produced this attempt — audit trail only. */
  jobExecutionId?: string;
}

export interface ReminderResult {
  sent:   boolean;
  status: NotifyOutcome['status'] | 'already_sent' | 'already_suppressed' | 'claim_error' | 'cooldown';
}

/**
 * How long after a delivered reminder this member is left alone
 * (SMS-AUDIT-v3 T3-5 / G26).
 *
 * The dedup above is per (reference, stage), which is exactly right for "did
 * we already send THIS reminder" and says nothing about "how many separate
 * reminders is this person getting at once". On the 1st of the month several
 * scanners come due together and each one legitimately claims its own slot,
 * so one member can receive a burst of distinct-but-simultaneous messages —
 * each individually correct, collectively indistinguishable from spam, and
 * each separately billed.
 *
 * One hour is chosen to collapse that burst and nothing more. It is
 * deliberately NOT a day: a long window would silently swallow a genuinely
 * urgent, genuinely different message (a loan-overdue alert behind a
 * contribution nudge sent that morning), and suppressing the wrong message is
 * worse than sending two.
 */
const COOLDOWN_MINUTES = 60;

type ClaimResult =
  | { outcome: 'send'; id: string }
  | { outcome: 'already_sent' | 'already_suppressed' | 'claim_error' };

/**
 * Claim (or resume) the (reference_type, reference_id, reminder_stage) slot.
 * The INSERT is the atomic claim — its UNIQUE constraint is what makes this
 * race-safe, unlike a SELECT NOT EXISTS check performed before a separate
 * INSERT. 'sent'/'suppressed' are terminal (never re-claimed); 'pending'/
 * 'failed' are resumable, so a genuine delivery failure gets a fresh attempt
 * on the next scheduled run instead of being silently abandoned forever.
 */
async function claim(input: ReminderInput): Promise<ClaimResult> {
  return withAdminDb(async (db) => {
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO reminder_dispatch_log
         (group_id, member_id, reference_type, reference_id, reminder_stage, job_execution_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (reference_type, reference_id, reminder_stage) DO NOTHING
       RETURNING id`,
      [input.groupId, input.memberId, input.referenceType, input.referenceId,
       input.reminderStage, input.jobExecutionId ?? null],
    );
    if (inserted.rows[0]) return { outcome: 'send', id: inserted.rows[0].id };

    const existing = await db.query<{ id: string; status: string }>(
      `SELECT id, status FROM reminder_dispatch_log
       WHERE reference_type=$1 AND reference_id=$2 AND reminder_stage=$3`,
      [input.referenceType, input.referenceId, input.reminderStage],
    );
    const row = existing.rows[0];
    if (!row) {
      // The row we just failed to insert should exist — append-only table,
      // nothing deletes it. Fail closed rather than risk a duplicate send.
      logger.error('[reminder] claim conflict but no existing row found', {
        referenceType: input.referenceType, referenceId: input.referenceId, stage: input.reminderStage,
      });
      return { outcome: 'claim_error' };
    }
    if (row.status === 'sent')       return { outcome: 'already_sent' };
    if (row.status === 'suppressed') return { outcome: 'already_suppressed' };
    return { outcome: 'send', id: row.id }; // 'pending' or 'failed' — retry.
  });
}

async function settle(id: string, outcome: NotifyOutcome): Promise<void> {
  const status = outcome.status === 'sent' ? 'sent'
    : outcome.status === 'suppressed' ? 'suppressed'
    : 'failed';
  await withAdminDb((db) =>
    db.query(
      // $2 is cast explicitly in BOTH the SET and the CASE below. Left
      // implicit, node-pg's Parse message carries no type OIDs, so Postgres
      // has to infer $2's type from context — and it sees two different
      // contexts (the enum column, and a bare-string comparison in the CASE),
      // which it refuses to unify: "inconsistent types deduced for parameter
      // $2". This was live in production — notify_contribution_reminders
      // failed outright (job_queue, 2026-08-01) the one time it actually
      // reached a candidate; notify_loan_due_alerts happened to never hit it
      // only because it never had a real candidate to settle either.
      `UPDATE reminder_dispatch_log
       SET status=$2::reminder_dispatch_status, channel=$3, reason=$4, attempts=attempts+1,
           sent_at=CASE WHEN $2::reminder_dispatch_status='sent' THEN NOW() ELSE sent_at END
       WHERE id=$1 AND status IN ('pending','failed')`,
      [id, status, outcome.channel === 'none' ? null : outcome.channel, outcome.detail ?? null],
    ),
  );
}

export interface ReminderHistoryQuery {
  page:     number;
  limit:    number;
  memberId?: string;
  status?:  'pending' | 'sent' | 'failed' | 'suppressed';
  from?:    string;
  to?:      string;
}

export interface ReminderHistoryRow {
  id:             string;
  member_id:      string;
  member_name:    string | null;
  reference_type: string;
  reference_id:   string;
  reminder_stage: string;
  status:         string;
  channel:        string | null;
  reason:         string | null;
  attempts:       number;
  created_at:     Date;
  sent_at:        Date | null;
}

/**
 * A group's reminder/automation history (SMS-AUDIT-v3 T3-5 / G21).
 *
 * `reminder_dispatch_log` has recorded every automated reminder since
 * migration 106 and had NO reader anywhere in the product — the same "built
 * the artifact, never wired the consumer" pattern the v3 audit named. An
 * officer could see that credits had been spent (sms_usage_logs) but not
 * which automations ran, which were deferred, or why a particular member did
 * or did not hear from the group.
 *
 * SUPPRESSED ROWS ARE INCLUDED, deliberately and centrally. A suppressed row
 * is the record that someone opted out and was therefore not contacted — it
 * is the single most useful row in the table for answering a data-subject
 * request under the Kenya DPA, and filtering it out (the obvious "show me
 * what was sent" instinct) would leave the product unable to demonstrate the
 * consent it honoured.
 *
 * Runs on the tenant pool, so `rls_reminder_dispatch_log` (FORCE RLS,
 * group-scoped, tightened in migration 120) is what fences the read — not the
 * WHERE clause alone. Verified before exposing, as the audit required: the
 * policy exists, FORCE is on, and app_tenant's blanket SELECT is constrained
 * by it.
 */
export async function listReminderHistory(
  ctx: TenantContext,
  params: ReminderHistoryQuery,
): Promise<PaginatedResult<ReminderHistoryRow>> {
  return withDb(ctx, async (client) => {
    const { page, limit, memberId, status, from, to } = params;
    const offset = (page - 1) * limit;

    const conds: string[] = ['r.group_id = $1'];
    const vals: unknown[] = [ctx.groupId];
    let idx = 2;

    if (memberId) { conds.push(`r.member_id = $${idx++}`);         vals.push(memberId); }
    if (status)   { conds.push(`r.status = $${idx++}::reminder_dispatch_status`); vals.push(status); }
    if (from)     { conds.push(`r.created_at::date >= $${idx++}`); vals.push(from); }
    if (to)       { conds.push(`r.created_at::date <= $${idx++}`); vals.push(to); }

    const where = conds.join(' AND ');

    const { rows: countRows } = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM reminder_dispatch_log r WHERE ${where}`, vals,
    );
    const total = parseInt(countRows[0].count, 10);

    const { rows } = await client.query<ReminderHistoryRow>(
      // LEFT JOIN, not INNER: members are ON DELETE CASCADE here so a row
      // without a member should not exist — but a history view that silently
      // drops rows it cannot fully describe is the wrong failure mode for a
      // table people will read to answer "what did you send me".
      `SELECT r.id, r.member_id,
              NULLIF(TRIM(CONCAT_WS(' ', m.first_name, m.last_name)), '') AS member_name,
              r.reference_type, r.reference_id, r.reminder_stage,
              r.status::text AS status, r.channel, r.reason, r.attempts,
              r.created_at, r.sent_at
         FROM reminder_dispatch_log r
         LEFT JOIN members m ON m.id = r.member_id
        WHERE ${where}
        ORDER BY r.created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}`,
      [...vals, limit, offset],
    );

    return { items: rows, total, page, pageSize: limit, totalPages: Math.ceil(total / limit) };
  });
}

/**
 * Whether this member has already had a reminder delivered inside the cooldown
 * window (G26).
 *
 * Reads reminder_dispatch_log rather than sms_usage_logs deliberately: it is
 * channel-agnostic, so a member reached on WhatsApp counts as reached. It also
 * only counts status='sent' — a suppressed or failed attempt did not reach
 * anybody and must not silence the next real one.
 *
 * Excludes the row just claimed by id, which is still 'pending' and so cannot
 * match anyway; the exclusion is belt-and-braces against a future change that
 * settles earlier.
 *
 * Fail-open on error: this is a politeness constraint, not a correctness one.
 * A cooldown lookup that breaks must not stop a reminder going out.
 */
async function inCooldown(input: ReminderInput, claimedId: string): Promise<boolean> {
  if (!input.memberId || !input.groupId) return false;
  try {
    return await withAdminDb(async (db) => {
      const { rows } = await db.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM reminder_dispatch_log
            WHERE group_id  = $1
              AND member_id = $2
              AND id       <> $3
              AND status    = 'sent'
              AND sent_at  >= NOW() - ($4 || ' minutes')::interval
         ) AS exists`,
        [input.groupId, input.memberId, claimedId, String(COOLDOWN_MINUTES)],
      );
      return rows[0]?.exists === true;
    });
  } catch (err) {
    logger.warn('[reminder] cooldown lookup failed — allowing the send', {
      err: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Send a reminder at most once per (referenceType, referenceId, reminderStage),
 * and at most one reminder per member per cooldown window.
 *
 * Safe to call every time a scanner considers a candidate eligible — repeat
 * calls for an already-sent stage are a cheap no-op (one INSERT that conflicts,
 * no external API call).
 *
 * A cooldown hit DEFERS, it does not drop: the claimed row is left 'pending',
 * which claim() treats as resumable, so the next scanner run sends it for
 * real. Marking it 'suppressed' would be terminal and would lose the reminder
 * permanently — the same append-only trap that burned eight welcome
 * executions in the 401 incident.
 */
export async function sendOnce(input: ReminderInput): Promise<ReminderResult> {
  const claimed = await claim(input);
  if (claimed.outcome !== 'send') return { sent: false, status: claimed.outcome };

  // Checked AFTER the claim (so the slot is held and no other run races us
  // into sending it) but BEFORE notifyMember — the whole value is in not
  // reserving credits and not calling the provider.
  if (await inCooldown(input, claimed.id)) {
    return { sent: false, status: 'cooldown' };
  }

  const outcome = await notifyMember(input);
  await settle(claimed.id, outcome);
  return { sent: outcome.status === 'sent', status: outcome.status };
}
