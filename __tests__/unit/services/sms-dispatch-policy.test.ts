import { withAdminDb } from '@/lib/db';
import { shouldPauseScheduledBulkSms, shouldPauseScheduledSmsJob } from '@/lib/services/sms-dispatch-policy';

jest.mock('@/lib/db', () => ({ withAdminDb: jest.fn() }));

it('holds recurring SMS jobs while allowing unrelated jobs and plain manual bulk sends', async () => {
  jest.mocked(withAdminDb).mockResolvedValue(false);
  await expect(shouldPauseScheduledSmsJob({ type: 'sms_process_schedules' })).resolves.toBe(true);
  await expect(shouldPauseScheduledSmsJob({ type: 'notify_weekly_savings_update' })).resolves.toBe(true);
  await expect(shouldPauseScheduledSmsJob({ type: 'sms_retry_failed' })).resolves.toBe(true);
  await expect(shouldPauseScheduledSmsJob({ type: 'email_birthday' })).resolves.toBe(false);
  await expect(shouldPauseScheduledSmsJob({ type: 'enterprise_webhook_delivery' })).resolves.toBe(false);
  await expect(shouldPauseScheduledBulkSms({})).resolves.toBe(false);
  await expect(shouldPauseScheduledBulkSms({ referenceType: 'schedule' })).resolves.toBe(true);
  await expect(shouldPauseScheduledBulkSms({ timeToSend: '2030-01-01 08:00' })).resolves.toBe(true);
});

it('identifies scheduled campaign jobs already in the queue', async () => {
  jest.mocked(withAdminDb).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await expect(shouldPauseScheduledBulkSms({ campaignId: 'scheduled' })).resolves.toBe(true);
  jest.mocked(withAdminDb).mockResolvedValueOnce(false).mockResolvedValueOnce(false);
  await expect(shouldPauseScheduledBulkSms({ campaignId: 'immediate' })).resolves.toBe(false);
  jest.mocked(withAdminDb).mockResolvedValueOnce(true);
  await expect(shouldPauseScheduledBulkSms({ referenceType: 'schedule' })).resolves.toBe(false);
});
