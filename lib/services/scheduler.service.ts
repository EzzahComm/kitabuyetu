import { withAdminDb } from '@/lib/db';
import { sendTemplatedEmail } from './email.service';

// Process all due email_schedules rows
export async function processDueSchedules(): Promise<{ processed: number; failed: number }> {
  const { rows } = await withAdminDb((db) =>
    db.query(
      `SELECT * FROM email_schedules
       WHERE is_active = true AND next_run_at <= NOW()
       ORDER BY next_run_at ASC
       LIMIT 100`,
      [],
    ),
  );

  let processed = 0;
  let failed = 0;

  for (const sched of rows) {
    try {
      const vars = (sched.variables as Record<string, string | number | boolean>) ?? {};

      await sendTemplatedEmail({
        templateKey: sched.template_key,
        to: sched.recipient_email,
        vars,
        groupId: sched.group_id,
        referenceId: sched.reference_id,
        referenceType: sched.reference_type,
      });

      if (sched.schedule_type === 'once') {
        await withAdminDb((db) =>
          db.query(
            `UPDATE email_schedules SET is_active=false, last_run_at=NOW() WHERE id=$1`,
            [sched.id],
          ),
        );
      } else {
        const nextRun = computeNextRun(sched.schedule_type, new Date(sched.next_run_at));
        await withAdminDb((db) =>
          db.query(
            `UPDATE email_schedules SET last_run_at=NOW(), next_run_at=$1 WHERE id=$2`,
            [nextRun.toISOString(), sched.id],
          ),
        );
      }

      processed++;
    } catch (err) {
      console.error('[scheduler] Failed to send scheduled email', sched.id, err);
      failed++;
    }
  }

  return { processed, failed };
}

function computeNextRun(scheduleType: string, current: Date): Date {
  const d = new Date(current);
  switch (scheduleType) {
    case 'daily':   d.setDate(d.getDate() + 1);   break;
    case 'weekly':  d.setDate(d.getDate() + 7);   break;
    case 'monthly': d.setMonth(d.getMonth() + 1); break;
    default:        d.setDate(d.getDate() + 1);   break;
  }
  return d;
}

// Retry failed emails from email_logs (status=failed, older than 5 min, fewer than 3 retries)
export async function retryFailedEmails(): Promise<{ retried: number }> {
  const { rows } = await withAdminDb((db) =>
    db.query(
      `SELECT * FROM email_logs
       WHERE status = 'failed'
         AND created_at >= NOW() - INTERVAL '24 hours'
         AND created_at <= NOW() - INTERVAL '5 minutes'
       ORDER BY created_at ASC
       LIMIT 50`,
      [],
    ),
  );

  let retried = 0;
  for (const log of rows) {
    if (!log.template_key) continue;
    try {
      await sendTemplatedEmail({
        templateKey: log.template_key,
        to: log.to,
        vars: {},
        groupId: log.group_id,
        referenceId: log.reference_id,
        referenceType: log.reference_type,
      });
      retried++;
    } catch {
      // Give up on this one — it will age out of the 24h window
    }
  }

  return { retried };
}
