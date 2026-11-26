import { withAdminDb } from '@/lib/db';
import { sendTemplatedEmail } from './email.service';
import { logger } from '@/lib/logger';

// Process all due email_schedules rows
export async function processDueSchedules(): Promise<{
  processed: number;
  failed: number;
}> {
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

      const result = await sendTemplatedEmail({
        templateKey: sched.template_key,
        to: sched.recipient_email,
        vars,
        groupId: sched.group_id,
        referenceId: sched.reference_id,
        referenceType: sched.reference_type,
      });

      if (!result.success) throw new Error(result.error ?? 'Scheduled email send failed');

      if (sched.schedule_type === 'once') {
        await withAdminDb(async (db) => {
          await db.query(`UPDATE email_schedules SET is_active=false, last_run_at=NOW() WHERE id=$1`, [sched.id]);
          await db.query(
            `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
             VALUES ($1, NULL, $2, 'email_schedule', $3, $4, $5)`,
            [
              sched.group_id,
              'email_schedule.sent_once',
              sched.id,
              JSON.stringify({ is_active: true, schedule_type: 'once' }),
              JSON.stringify({ is_active: false, status: 'completed' }),
            ],
          );
        });
      } else {
        const nextRun = computeNextRun(sched.schedule_type, new Date(sched.next_run_at));
        await withAdminDb(async (db) => {
          await db.query(`UPDATE email_schedules SET last_run_at=NOW(), next_run_at=$1 WHERE id=$2`, [
            nextRun.toISOString(),
            sched.id,
          ]);
          await db.query(
            `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
             VALUES ($1, NULL, $2, 'email_schedule', $3, $4, $5)`,
            [
              sched.group_id,
              'email_schedule.sent_recurring',
              sched.id,
              JSON.stringify({ next_run_at: sched.next_run_at }),
              JSON.stringify({ next_run_at: nextRun.toISOString() }),
            ],
          );
        });
      }

      processed++;
    } catch (err) {
      logger.error('[scheduler] Failed to send scheduled email', sched.id, err);
      failed++;
    }
  }

  return { processed, failed };
}

function computeNextRun(scheduleType: string, current: Date): Date {
  const d = new Date(current);
  switch (scheduleType) {
    case 'daily':
      d.setDate(d.getDate() + 1);
      break;
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'monthly':
      d.setMonth(d.getMonth() + 1);
      break;
    default:
      d.setDate(d.getDate() + 1);
      break;
  }
  return d;
}
