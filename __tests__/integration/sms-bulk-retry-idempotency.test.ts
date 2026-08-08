/**
 * sms_bulk_send job-retry idempotency (SMS_MESSAGING_AUDIT_2026-08.md H3),
 * against real Postgres.
 *
 * resetStuckJobs (fixed separately, PR #34) reclaims a job that timed out
 * without ever finishing, incrementing attempts and setting it back to
 * pending — a real retry, not a crash-recovery no-op, re-invokes
 * handleSmsBulkSend with the SAME payload.phones list. Before this fix,
 * sendBulkCampaign had no memory of what an earlier attempt already did:
 * every recipient — including ones already billed and sent — got a brand
 * new reservation, a brand new log row, and a brand new dispatch to the
 * provider. This file proves a simulated retry (calling sendBulkCampaign
 * twice with the same dispatchBatchId/campaignId and the same phone list)
 * does none of that.
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

function acceptedResponses(phones: string[]): BulkSmsResult {
  return {
    responses: phones.map((mobile, i) => ({
      responseCode: 200, responseDescription: 'Success', mobile,
      messageId: `msg-${i + 1}`, networkId: '1', success: true, clientSmsId: i + 1,
    })),
    sent: phones.length, failed: 0,
  };
}

describe('sms_bulk_send retry idempotency (H3)', () => {
  beforeEach(() => {
    mockSendBulkSmsChunked.mockReset();
  });

  it('an ad-hoc (no-campaign) retry with the same dispatchBatchId does not re-bill or re-dispatch', async () => {
    await resetDatabase();
    const { groupId } = await createTestGroup('treasurer');
    await provisionBilling(groupId, 100);
    const phones = ['254700000010', '254700000011'];
    const jobId  = '11111111-1111-1111-1111-111111111111';

    mockSendBulkSmsChunked.mockResolvedValue(acceptedResponses(phones));

    const first = await smsService.sendBulkCampaign({
      groupId, phones, message: 'reminder', sentBy: 'test', dispatchBatchId: jobId,
    });
    expect(first.sent).toBe(2);
    expect(mockSendBulkSmsChunked).toHaveBeenCalledTimes(1);

    const [afterFirst] = await rawQuery<{ sms_credits: string }>(
      `SELECT sms_credits FROM billing_accounts WHERE group_id=$1`, [groupId],
    );

    // The retry: identical payload, same job id (the real shape of a
    // resetStuckJobs reclaim, which re-runs handleSmsBulkSend(job.payload, job.id)).
    const second = await smsService.sendBulkCampaign({
      groupId, phones, message: 'reminder', sentBy: 'test', dispatchBatchId: jobId,
    });
    expect(second.sent).toBe(0);
    expect(second.failed).toBe(0);
    // The provider was never called again — nothing new to dispatch.
    expect(mockSendBulkSmsChunked).toHaveBeenCalledTimes(1);

    const [afterSecond] = await rawQuery<{ sms_credits: string }>(
      `SELECT sms_credits FROM billing_accounts WHERE group_id=$1`, [groupId],
    );
    // Not double-charged.
    expect(afterSecond.sms_credits).toBe(afterFirst.sms_credits);

    const logs = await rawQuery<{ n: string }>(
      `SELECT count(*) AS n FROM sms_usage_logs WHERE group_id=$1`, [groupId],
    );
    // One row per recipient, not two.
    expect(Number(logs[0].n)).toBe(2);
  });

  it('a partially-completed retry only dispatches the recipients not yet logged, and totals stay correct', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('treasurer');
    await provisionBilling(groupId, 100);
    const phones = ['254700000012', '254700000013', '254700000014'];
    const jobId  = '22222222-2222-2222-2222-222222222222';

    const [{ id: campaignId }] = await rawQuery<{ id: string }>(
      `INSERT INTO sms_campaigns (group_id, name, message, created_by)
       VALUES ($1, 'Test campaign', 'reminder', $2) RETURNING id`,
      [groupId, officerId],
    );

    // Simulate an earlier attempt that only got through the first recipient
    // before "crashing" (the mock only ever returns one response for the
    // first call).
    mockSendBulkSmsChunked.mockResolvedValueOnce(acceptedResponses([phones[0]]));
    const first = await smsService.sendBulkCampaign({
      groupId, phones: [phones[0]], message: 'reminder', sentBy: 'test',
      campaignId, dispatchBatchId: jobId,
    });
    expect(first.sent).toBe(1);

    // The retry re-submits the FULL original list (the real shape of a
    // job-level retry — the job payload doesn't shrink between attempts).
    mockSendBulkSmsChunked.mockResolvedValueOnce(acceptedResponses([phones[1], phones[2]]));
    const second = await smsService.sendBulkCampaign({
      groupId, phones, message: 'reminder', sentBy: 'test',
      campaignId, dispatchBatchId: jobId,
    });
    // Only the two NOT already logged were dispatched.
    expect(second.sent).toBe(2);
    expect(mockSendBulkSmsChunked).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ mobile: phones[1] }),
        expect.objectContaining({ mobile: phones[2] }),
      ]),
    );
    expect(mockSendBulkSmsChunked).toHaveBeenCalledTimes(2);

    const logs = await rawQuery<{ n: string }>(
      `SELECT count(*) AS n FROM sms_usage_logs WHERE group_id=$1`, [groupId],
    );
    expect(Number(logs[0].n)).toBe(3); // one per recipient, not four

    const [campaign] = await rawQuery<{ status: string; sent_count: number; failed_count: number }>(
      `SELECT status, sent_count, failed_count FROM sms_campaigns WHERE id=$1`, [campaignId],
    );
    // Totals aggregate across BOTH calls, not just the second call's own batch.
    expect(campaign.status).toBe('completed');
    expect(campaign.sent_count).toBe(3);
    expect(campaign.failed_count).toBe(0);
  });

  it('a fully-deduped retry (everything already logged) finishes a campaign stuck at "sending"', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('treasurer');
    await provisionBilling(groupId, 100);
    const phones = ['254700000015', '254700000016'];
    const jobId  = '33333333-3333-3333-3333-333333333333';

    const [{ id: campaignId }] = await rawQuery<{ id: string }>(
      `INSERT INTO sms_campaigns (group_id, name, message, created_by, status)
       VALUES ($1, 'Test campaign', 'reminder', $2, 'sending') RETURNING id`,
      [groupId, officerId],
    );

    // Simulate: an earlier attempt logged and dispatched everyone
    // successfully, but crashed before its own completion UPDATE ran — the
    // campaign is left at 'sending' with real rows already in place.
    for (const phone of phones) {
      await rawQuery(
        `INSERT INTO sms_usage_logs
           (group_id, recipient_phone, message_text, credits_deducted, credits_reserved,
            billing_state, status, correlation_id, campaign_id, provider, payer_type)
         VALUES ($1,$2,'reminder',0.9,0,'consumed','sent',$3,$3,'textsms','group')`,
        [groupId, phone, campaignId],
      );
    }

    const retry = await smsService.sendBulkCampaign({
      groupId, phones, message: 'reminder', sentBy: 'test',
      campaignId, dispatchBatchId: jobId,
    });
    expect(retry.sent).toBe(0);
    expect(mockSendBulkSmsChunked).not.toHaveBeenCalled();

    const [campaign] = await rawQuery<{ status: string; sent_count: number }>(
      `SELECT status, sent_count FROM sms_campaigns WHERE id=$1`, [campaignId],
    );
    expect(campaign.status).toBe('completed');
    expect(campaign.sent_count).toBe(2);
  });
});
