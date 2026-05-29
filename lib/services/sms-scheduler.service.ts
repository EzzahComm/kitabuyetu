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
}

/** Process due sms_schedules. Enqueues a send per schedule, then advances it. */
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
    if (!message) {
      logger.warn('[sms-scheduler] schedule has no message/template, skipping', { id: s.id });
      await advanceSchedule(s);
      skipped++;
      continue;
    }

    const phones = await resolveSmsRecipients(s.group_id, s.recipient_type, s.raw_recipients);
    if (phones.length === 0) {
      await advanceSchedule(s);
      skipped++;
      continue;
    }

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
      { priority: 6, max_attempts: 3 },
    );

    await advanceSchedule(s);
    processed++;
  }

  return { processed, skipped };
}

/** Deactivate one-time schedules; advance recurring ones to their next run. */
async function advanceSchedule(s: ScheduleRow): Promise<void> {
  if (s.schedule_type === 'one_time') {
    await withAdminDb((db) =>
      db.query(`UPDATE sms_schedules SET is_active=false, last_run_at=NOW() WHERE id=$1`, [s.id]),
    );
    return;
  }
  const next = computeNextRun(s.schedule_type, new Date(s.next_run_at));
  await withAdminDb((db) =>
    db.query(`UPDATE sms_schedules SET last_run_at=NOW(), next_run_at=$1 WHERE id=$2`, [next.toISOString(), s.id]),
  );
}

function computeNextRun(scheduleType: string, current: Date): Date {
  const d = new Date(current);
  switch (scheduleType) {
    case 'weekly':  d.setDate(d.getDate() + 7);   break;
    case 'monthly': d.setMonth(d.getMonth() + 1); break;
    case 'daily':
    default:        d.setDate(d.getDate() + 1);   break;
  }
  return d;
}

/** Dispatch sms_campaigns whose scheduled_at has arrived. */
export async function processDueScheduledCampaigns(): Promise<{ processed: number }> {
  const rows = await withAdminDb((db) =>
    db.query<CampaignRow>(
      `SELECT id, group_id, message, recipient_type, raw_recipients, created_by
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
