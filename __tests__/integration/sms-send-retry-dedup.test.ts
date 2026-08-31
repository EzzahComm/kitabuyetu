/**
 * smsService.send correlation-key dedup (SMS-AUDIT-v3 G7, pathway T1-2).
 *
 * There were two uncoordinated retry owners for one message. The trigger
 * engine re-invokes send() with the same phones on its own backoff
 * (retryOrFail), while the first attempt's failures also wrote sms_failures
 * rows that the sms_retry_failed cron re-sends five minutes later. send() had
 * no dedup of its own — unlike sendBulkCampaign, which has had one since H3 —
 * so a transient provider outage produced duplicate DELIVERED messages and
 * duplicate charges, not merely duplicate attempts.
 */
import { smsService } from '@/lib/services/sms.service';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';
import type { SmsResponse } from '@/lib/services/textsms.service';

const mockSendSingleSms = jest.fn<Promise<SmsResponse>, [unknown]>();

jest.mock('@/lib/services/textsms.service', () => ({
  sendSingleSms: (...args: unknown[]) => mockSendSingleSms(args[0]),
  sendBulkSms: jest.fn(),
  sendBulkSmsChunked: jest.fn(),
  getDeliveryReport: jest.fn(),
  getProviderBalance: jest.fn(),
}));

function accepted(mobile: string): SmsResponse {
  return {
    responseCode: 200, responseDescription: 'Success', mobile,
    messageId: 'msg-1', networkId: '1', success: true, clientSmsId: 1,
  };
}

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

const EVENT_ID = '88888888-8888-8888-8888-888888888888';
const PHONE = '254700000041';

describe('send() retry dedup (G7)', () => {
  beforeEach(() => mockSendSingleSms.mockReset());

  it('does not re-send or re-charge a recipient already logged under the same event', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('treasurer');
    await provisionBilling(groupId, 100);
    const ctx = { userId: officerId, groupId, role: 'chairperson' as const };

    mockSendSingleSms.mockResolvedValue(accepted(PHONE));

    const first = await smsService.send(ctx, PHONE, 'hello', 'payment.received', EVENT_ID);
    expect(first).toHaveLength(1);
    expect(mockSendSingleSms).toHaveBeenCalledTimes(1);

    const [afterFirst] = await rawQuery<{ n: string; charged: string }>(
      `SELECT count(*) AS n, COALESCE(SUM(credits_deducted),0) AS charged
         FROM sms_usage_logs WHERE group_id=$1`, [groupId],
    );

    // The trigger engine's own retry: same phones, same event id.
    const retry = await smsService.send(ctx, PHONE, 'hello', 'payment.received', EVENT_ID);

    // The existing row comes back so the caller can read its status...
    expect(retry).toHaveLength(1);
    // ...but nothing was dispatched again, and nothing new was written.
    expect(mockSendSingleSms).toHaveBeenCalledTimes(1);

    const [afterRetry] = await rawQuery<{ n: string; charged: string }>(
      `SELECT count(*) AS n, COALESCE(SUM(credits_deducted),0) AS charged
         FROM sms_usage_logs WHERE group_id=$1`, [groupId],
    );
    expect(afterRetry.n).toBe(afterFirst.n);
    expect(Number(afterRetry.charged)).toBe(Number(afterFirst.charged));
  });

  it('returns the existing row so a caller can still see it FAILED', async () => {
    // The trigger engine decides retry-vs-settle from the returned rows'
    // status. If dedup hid them it would read [] as "everyone opted out" and
    // settle terminally on an append-only table.
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('treasurer');
    await provisionBilling(groupId, 100);
    const ctx = { userId: officerId, groupId, role: 'chairperson' as const };

    mockSendSingleSms.mockRejectedValue(new Error('provider down'));
    const first = await smsService.send(ctx, PHONE, 'hello', 'payment.received', EVENT_ID);
    expect(first[0].status).toBe('failed');

    const retry = await smsService.send(ctx, PHONE, 'hello', 'payment.received', EVENT_ID);
    expect(retry).toHaveLength(1);
    expect(retry[0].status).toBe('failed');
    expect(retry[0].id).toBe(first[0].id);
  });

  it('still sends a NEW recipient added to the same event', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('treasurer');
    await provisionBilling(groupId, 100);
    const ctx = { userId: officerId, groupId, role: 'chairperson' as const };

    mockSendSingleSms.mockResolvedValue(accepted(PHONE));
    await smsService.send(ctx, PHONE, 'hello', 'payment.received', EVENT_ID);
    expect(mockSendSingleSms).toHaveBeenCalledTimes(1);

    const second = '254700000042';
    const both = await smsService.send(ctx, [PHONE, second], 'hello', 'payment.received', EVENT_ID);
    // One skipped, one genuinely new.
    expect(both).toHaveLength(2);
    expect(mockSendSingleSms).toHaveBeenCalledTimes(2);
  });

  it('does NOT dedup a manual send, which carries no correlation key', async () => {
    // Sending the same message twice by hand is legitimate and must stay
    // possible — only event-driven sends carry a referenceId.
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('treasurer');
    await provisionBilling(groupId, 100);
    const ctx = { userId: officerId, groupId, role: 'chairperson' as const };

    mockSendSingleSms.mockResolvedValue(accepted(PHONE));
    await smsService.send(ctx, PHONE, 'hello');
    await smsService.send(ctx, PHONE, 'hello');

    expect(mockSendSingleSms).toHaveBeenCalledTimes(2);
    const [{ n }] = await rawQuery<{ n: string }>(
      `SELECT count(*) AS n FROM sms_usage_logs WHERE group_id=$1`, [groupId],
    );
    expect(n).toBe('2');
  });
});
