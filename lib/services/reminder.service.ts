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
  status: NotifyOutcome['status'] | 'already_sent' | 'already_suppressed' | 'claim_error';
}

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
      `UPDATE reminder_dispatch_log
       SET status=$2, channel=$3, reason=$4, attempts=attempts+1,
           sent_at=CASE WHEN $2='sent' THEN NOW() ELSE sent_at END
       WHERE id=$1 AND status IN ('pending','failed')`,
      [id, status, outcome.channel === 'none' ? null : outcome.channel, outcome.detail ?? null],
    ),
  );
}

/**
 * Send a reminder at most once per (referenceType, referenceId, reminderStage).
 * Safe to call every time a scanner considers a candidate eligible — repeat
 * calls for an already-sent stage are a cheap no-op (one INSERT that conflicts,
 * no external API call).
 */
export async function sendOnce(input: ReminderInput): Promise<ReminderResult> {
  const claimed = await claim(input);
  if (claimed.outcome !== 'send') return { sent: false, status: claimed.outcome };

  const outcome = await notifyMember(input);
  await settle(claimed.id, outcome);
  return { sent: outcome.status === 'sent', status: outcome.status };
}
