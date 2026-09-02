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
import { withAdminDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { notifyMember, type NotifyRecipient, type NotifyOutcome } from './notifications.service';

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
