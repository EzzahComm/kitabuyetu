/**
 * Provider-exception handling on the bulk dispatch path
 * (SMS_MESSAGING_AUDIT_2026-08.md H5), against real Postgres.
 *
 * A provider *rejection* (sendBulkSmsChunked resolves with success: false
 * per item) was already handled correctly before this fix. What H5 flagged
 * is the OTHER failure mode: sendBulkSmsChunked itself throwing — a network
 * error, timeout, or DNS failure, where the provider never answered at all.
 * Before this fix that exception propagated straight out of
 * sendBulkCampaign: every row in the batch was left at its INSERT default
 * (status='queued', billing_state='reserved'), no sms_failures row was
 * written (so retryFailures() would never see it), and the reservation only
 * cleared ~15 minutes later via the stale-reservation sweeper — burning the
 * retry window and looking, from the campaign's own row, like the send
 * never happened at all.
 *
 * This file proves: the exception is caught, every row in the batch is
 * marked failed with the thrown reason, a retryable sms_failures row is
 * written for each recipient, the reservation is released (not consumed —
 * nothing here was ever accepted by the provider), and a campaign is
 * finished at 'completed' rather than left stuck at 'sending'.
 */
import { smsService } from '@/lib/services/sms.service';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';
import type { BulkSmsResult } from '@/lib/services/textsms.service';

const mockSendBulkSmsChunked = jest.fn<Promise<BulkSmsResult>, [unknown]>();

jest.mock('@/lib/services/textsms.service', () => ({
  sendSingleSms: jest.fn(),
  sendBulkSms: jest.fn(),
  sendBulkSmsChunked: (...args: unknown[]) => mockSendBulkSmsChunked(args[0]),
  getDeliveryReport: jest.fn(),
  getProviderBalance: jest.fn(),
}));

async function provisionBilling(groupId: string, credits: number): Promise<void> {
  await rawQuery(
    `INSERT INTO billing_accounts (group_id, sms_credits)
     VALUES ($1, $2)
     ON CONFLICT (group_id) DO UPDATE SET sms_credits = EXCLUDED.sms_credits`,
    [groupId, credits],
  );
  await rawQuery(
    `INSERT INTO subscriptions (group_id, plan_type, status, sms_rate, monthly_fee, sms_allowance_included)
     VALUES ($1, 'starter', 'active', 0.90, 0, 0)
     ON CONFLICT DO NOTHING`,
    [groupId],
  );
}

describe('sendBulkCampaign dispatch exception handling (H5)', () => {
  beforeEach(() => {
    mockSendBulkSmsChunked.mockReset();
  });

  it('a thrown dispatch error marks every row failed, refunds the reservation, and writes retryable sms_failures rows', async () => {
    await resetDatabase();
    const { groupId } = await createTestGroup('treasurer');
    await provisionBilling(groupId, 100);
    const phones = ['254700000020', '254700000021'];

    const [{ sms_credits: before }] = await rawQuery<{ sms_credits: string }>(
      `SELECT sms_credits FROM billing_accounts WHERE group_id=$1`, [groupId],
    );

    mockSendBulkSmsChunked.mockRejectedValueOnce(new Error('ETIMEDOUT'));

    const result = await smsService.sendBulkCampaign({
      groupId, phones, message: 'reminder', sentBy: 'test',
    });

    // Nothing sent, but the call did not throw out of sendBulkCampaign.
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(2);

    const logs = await rawQuery<{ status: string; failed_reason: string; billing_state: string }>(
      `SELECT status, failed_reason, billing_state FROM sms_usage_logs WHERE group_id=$1 ORDER BY recipient_phone`,
      [groupId],
    );
    expect(logs).toHaveLength(2);
    for (const log of logs) {
      expect(log.status).toBe('failed');
      expect(log.failed_reason).toContain('ETIMEDOUT');
    }

    // Never accepted by the provider, so the reservation must be released,
    // not consumed — no charge for a send that never happened.
    const [{ sms_credits: after }] = await rawQuery<{ sms_credits: string }>(
      `SELECT sms_credits FROM billing_accounts WHERE group_id=$1`, [groupId],
    );
    expect(after).toBe(before);

    // A retryable sms_failures row per recipient — the part that was
    // entirely missing before this fix.
    const failures = await rawQuery<{ phone: string; failure_code: string; next_retry_at: Date | null }>(
      `SELECT phone, failure_code, next_retry_at FROM sms_failures WHERE group_id=$1 ORDER BY phone`,
      [groupId],
    );
    expect(failures).toHaveLength(2);
    for (const f of failures) {
      expect(f.failure_code).toBe('-1'); // sentinel: no provider response to report
      expect(f.next_retry_at).not.toBeNull();
    }
  });

  it('a thrown dispatch error finishes a campaign at completed rather than leaving it stuck at sending', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('treasurer');
    await provisionBilling(groupId, 100);
    const phones = ['254700000022', '254700000023', '254700000024'];

    const [{ id: campaignId }] = await rawQuery<{ id: string }>(
      `INSERT INTO sms_campaigns (group_id, name, message, created_by)
       VALUES ($1, 'Test campaign', 'reminder', $2) RETURNING id`,
      [groupId, officerId],
    );

    mockSendBulkSmsChunked.mockRejectedValueOnce(new Error('ECONNRESET'));

    const result = await smsService.sendBulkCampaign({
      groupId, phones, message: 'reminder', sentBy: 'test', campaignId,
    });
    expect(result.failed).toBe(3);

    const [campaign] = await rawQuery<{ status: string; sent_count: number; failed_count: number }>(
      `SELECT status, sent_count, failed_count FROM sms_campaigns WHERE id=$1`, [campaignId],
    );
    expect(campaign.status).toBe('completed');
    expect(campaign.sent_count).toBe(0);
    expect(campaign.failed_count).toBe(3);
  });
});
