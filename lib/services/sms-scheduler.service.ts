/**
 * SMS scheduler — fires due sms_schedules rows and due scheduled sms_campaigns.
 *
 * Driven by the sms_process_schedules cron job (every 5 min). Both paths
 * resolve recipients at *run time* (so membership changes since scheduling are
 * respected) and hand the actual send to the durable sms_bulk_send job, which
 * owns billing, opt-out filtering, dispatch and retries.
 *
 * Recurring/one-time schedule types handled: one_time, daily, weekly, monthly.
 * The 'birthday' and 'loan_due' types are intentionally NOT processed here —
 * they need recipient-rule logic (birthdays today / loans due in N days) rather
 * than a fixed next_run_at cadence, and loan_due overlaps the existing
 * notify_loan_due_alerts job. They are left for a dedicated follow-up.
 */
import type { PoolClient } from 'pg';
import { withAdminDb } from '@/lib/db';
import { enqueueJob } from '@/lib/jobs';
import { logger } from '@/lib/logger';
import { resolveSmsRecipients } from './sms.service';

interface ScheduleRow {
  id:             string;
  group_id:       string;
  schedule_type:  string;
  message:        string | null;
  template_body:  string | null;
  recipient_type: string;
  raw_recipients: unknown;
  next_run_at:    string;
  created_by:     string;
}

interface CampaignRow {
  id:             string;
  group_id:       string;
  message:        string;
  recipient_type: string;
  raw_recipients: unknown;
  created_by:     string;
  payer_type:             string;
  payer_organization_id:  string | null;
}

/**
 * Process due sms_schedules — exactly one send per occurrence.
 *
 * Each due schedule is handled in its own transaction that (1) *claims* the
 * occurrence — advancing next_run_at (or deactivating a one_time) under a
 * FOR UPDATE SKIP LOCKED row lock — and (2) enqueues the send on that same
 * transaction. Both commit together, which is what makes a reminder fire once:
 *
 *   - Concurrent ticks / a resetStuckJobs re-run can't double-send: the claim
 *     advances next_run_at, so any other runner's re-check (next_run_at <= NOW)
 *     misses the row and enqueues nothing.
 *   - A crash mid-way rolls back both the advance and the enqueue, so the next
 *     tick re-selects the still-due schedule and sends it — never lost, never
 *     duplicated.
 *
 * The dedup_key (schedule id + the exact claimed occurrence) is belt-and-braces
 * on top of the claim.
 */
export async function processDueSmsSchedules(): Promise<{ processed: number; skipped: number }> {
  const rows = await withAdminDb((db) =>
    db.query<ScheduleRow>(
      `SELECT s.id, s.group_id, s.schedule_type, s.message, s.recipient_type,
              s.raw_recipients, s.next_run_at, s.created_by,
              t.body AS template_body
       FROM sms_schedules s
       LEFT JOIN sms_templates t ON t.id = s.template_id
       WHERE s.is_active = true
         AND s.next_run_at IS NOT NULL
         AND s.next_run_at <= NOW()
         AND s.schedule_type IN ('one_time','daily','weekly','monthly')
       ORDER BY s.next_run_at ASC
       LIMIT 100`,
      [],
    ).then((r) => r.rows),
  );

  let processed = 0;
  let skipped   = 0;

  for (const s of rows) {
    const message = s.template_body ?? s.message;
    // Resolve recipients (reads only) before opening the claim transaction, so
    // membership changes since scheduling are respected and the row lock is
    // held for as short a time as possible.
    const phones = message
      ? await resolveSmsRecipients(s.group_id, s.recipient_type, s.raw_recipients)
      : [];

    const outcome = await withAdminDb(async (client) => {
      const occurrence = await claimOccurrence(client, s.id);
      if (occurrence === null) return 'raced';   // another tick already claimed it

      if (!message) {
        logger.warn('[sms-scheduler] schedule has no message/template, skipping', { id: s.id });
        return 'skipped';
      }
      if (phones.length === 0) return 'skipped';

      await enqueueJob(
        'sms_bulk_send',
        {
          phones,
          message,
          groupId:       s.group_id,
          sentBy:        s.created_by,
          referenceType: 'schedule',
          referenceId:   s.id,
        },
        {
          priority:  6,
          max_attempts: 3,
          // One send per (schedule, occurrence). The occurrence advances each
          // run, so tomorrow's daily reminder is a distinct key and still sends.
          dedup_key: `sms_bulk_send:schedule:${s.id}:${occurrence}`,
        },
        client,
      );
      return 'processed';
    });

    if (outcome === 'processed') processed++;
    else if (outcome === 'skipped') skipped++;
    // 'raced' → neither; another concurrent tick owns this occurrence.
  }

  return { processed, skipped };
}

/**
 * Atomically claim a due occurrence on the caller's transaction: advance a
 * recurring schedule to its next run (or deactivate a one_time), but only while
 * it is still due and unlocked. Returns the occurrence just consumed (the
 * pre-advance next_run_at, used to key the send) or null if another transaction
 * already holds the row or advanced it past due.
 */
async function claimOccurrence(client: PoolClient, id: string): Promise<string | null> {
  const { rows } = await client.query<{ occurrence: string }>(
    `WITH claimed AS (
       SELECT id, schedule_type, next_run_at AS occurrence
       FROM   sms_schedules
       WHERE  id = $1 AND is_active = true AND next_run_at <= NOW()
       FOR UPDATE SKIP LOCKED
     )
     UPDATE sms_schedules s
     SET    last_run_at = NOW(),
            is_active   = CASE WHEN c.schedule_type = 'one_time' THEN false ELSE s.is_active END,
            next_run_at = CASE c.schedule_type
                            WHEN 'weekly'  THEN c.occurrence + INTERVAL '7 days'
                            WHEN 'monthly' THEN c.occurrence + INTERVAL '1 month'
                            WHEN 'daily'   THEN c.occurrence + INTERVAL '1 day'
                            ELSE c.occurrence
                          END
     FROM   claimed c
     WHERE  s.id = c.id
     RETURNING c.occurrence`,
    [id],
  );
  return rows[0]?.occurrence ?? null;
}

/** Dispatch sms_campaigns whose scheduled_at has arrived. */
export async function processDueScheduledCampaigns(): Promise<{ processed: number }> {
  const rows = await withAdminDb((db) =>
    db.query<CampaignRow>(
      `SELECT id, group_id, message, recipient_type, raw_recipients, created_by,
              payer_type, payer_organization_id
       FROM sms_campaigns
       WHERE status='scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= NOW()
       ORDER BY scheduled_at ASC
       LIMIT 100`,
      [],
    ).then((r) => r.rows),
  );

  let processed = 0;

  for (const c of rows) {
    const phones = await resolveSmsRecipients(c.group_id, c.recipient_type, c.raw_recipients);

    if (phones.length === 0) {
      await withAdminDb((db) =>
        db.query(
          `UPDATE sms_campaigns
           SET status='completed', completed_at=NOW(), sent_count=0, failed_count=0, updated_at=NOW()
           WHERE id=$1 AND status='scheduled'`,
          [c.id],
        ),
      );
      continue;
    }

    // Enqueue first (idempotent via dedup_key), then flip out of 'scheduled'.
    // If the flip fails, a later tick re-runs this and the dedup_key prevents a
    // duplicate job — self-healing rather than orphaning the campaign.
    await enqueueJob(
      'sms_bulk_send',
      {
        campaignId: c.id,
        phones,
        message:    c.message,
        groupId:    c.group_id,
        sentBy:     c.created_by,
        // Carried from the campaign row so a scheduled organization campaign
        // still bills the organization when it eventually fires.
        fundedBy:            c.payer_type,
        payerOrganizationId: c.payer_organization_id,
      },
      { priority: 7, max_attempts: 3, dedup_key: `sms_bulk_send:${c.id}` },
    );

    await withAdminDb((db) =>
      db.query(
        `UPDATE sms_campaigns
         SET status='sending', started_at=NOW(), recipient_count=$2, updated_at=NOW()
         WHERE id=$1 AND status='scheduled'`,
        [c.id, phones.length],
      ),
    );
    processed++;
  }

  return { processed };
}
