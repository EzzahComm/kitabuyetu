import { withAdminDb } from '@/lib/db';
import { isFeatureEnabled } from './feature-flags.service';
import { logger } from '@/lib/logger';
import type { Job } from '@/lib/jobs/types';

export const SCHEDULED_SMS_FLAG = 'sms_scheduled_dispatch';

const scheduledSmsJobs = new Set<Job['type']>([
  'notify_loan_due_alerts',
  'notify_contribution_reminders',
  'notify_weekly_savings_update',
  'sms_birthday_reminders',
  'sms_process_schedules',
  'sms_trigger_fire',
]);

export async function shouldPauseScheduledSmsJob(job: Pick<Job, 'type'>): Promise<boolean> {
  return scheduledSmsJobs.has(job.type) && !(await scheduledSmsAllowed());
}

async function scheduledSmsAllowed(): Promise<boolean> {
  try {
    return await withAdminDb((db) => isFeatureEnabled(db, SCHEDULED_SMS_FLAG, {}));
  } catch (error) {
    logger.warn('[sms] Could not verify the schedule pause. Holding automatic SMS.', { error: String(error) });
    return false;
  }
}

export async function shouldPauseScheduledBulkSms(payload: {
  referenceType?: unknown;
  timeToSend?: unknown;
  campaignId?: unknown;
}): Promise<boolean> {
  const explicitSchedule = payload.referenceType === 'schedule' || Boolean(payload.timeToSend);
  const campaignId = typeof payload.campaignId === 'string' ? payload.campaignId : undefined;
  if (!explicitSchedule && !campaignId) return false;
  if (await scheduledSmsAllowed()) return false;
  if (explicitSchedule) return true;

  try {
    return await withAdminDb(async (db) => {
      const { rows } = await db.query('SELECT 1 FROM sms_campaigns WHERE id = $1 AND scheduled_at IS NOT NULL', [
        campaignId,
      ]);
      return rows.length > 0;
    });
  } catch {
    return true;
  }
}
