/**
 * Multi-chunk campaign completion tracking (closes SMS_MESSAGING_AUDIT_
 * 2026-08.md H3 — docs/messaging/UNIFIED_MESSAGING_ARCHITECTURE.md Phase 3
 * item 10), against real Postgres.
 *
 * QStash-dispatched campaigns (lib/queue/qstash.ts, lib/jobs/handlers.ts's
 * handleSmsBulkSend) call sendBulkCampaign once PER CHUNK, each an
 * independent invocation carrying the campaign's TRUE total via
 * totalRecipientCount — not each chunk's own slice size. Before this,
 * sendBulkCampaign's per-call `recipient_count`/`status='completed'` writes
 * assumed a single call handled the WHOLE campaign (the only shape that
 * existed pre-chunking — see sms-bulk-retry-idempotency.test.ts's H3
 * coverage of THAT invariant). This file proves the new one: a campaign
 * split across chunks stays 'sending' until every chunk has actually run,
 * and only then flips to 'completed' with the correctly aggregated totals —
 * never early, never stuck.
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

describe('sms_bulk_send chunked-dispatch completion tracking (H3)', () => {
  beforeEach(() => {
    mockSendBulkSmsChunked.mockReset();
  });

  it('stays "sending" after the first of two chunks, and only completes once the second lands', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('treasurer');
    await provisionBilling(groupId, 100);

    const chunkA = ['254700000020', '254700000021'];
    const chunkB = ['254700000022'];
    const totalRecipientCount = chunkA.length + chunkB.length;
    const jobId = '44444444-4444-4444-4444-444444444444';

    const [{ id: campaignId }] = await rawQuery<{ id: string }>(
      `INSERT INTO sms_campaigns (group_id, name, message, created_by)
       VALUES ($1, 'Chunked campaign', 'reminder', $2) RETURNING id`,
      [groupId, officerId],
    );

    // Chunk 0 of 2 — carries the TRUE total, not its own 2-recipient slice.
    mockSendBulkSmsChunked.mockResolvedValueOnce(acceptedResponses(chunkA));
    const first = await smsService.sendBulkCampaign({
      groupId, phones: chunkA, message: 'reminder', sentBy: 'test',
      campaignId, dispatchBatchId: `${jobId}:chunk:0`, totalRecipientCount,
    });
    expect(first.sent).toBe(2);

    const [afterChunkA] = await rawQuery<{ status: string; recipient_count: number; sent_count: number }>(
      `SELECT status, recipient_count, sent_count FROM sms_campaigns WHERE id=$1`, [campaignId],
    );
    // The critical assertion: chunk A alone must NOT complete the campaign —
    // the pre-chunking code (unconditional status='completed' per call)
    // would have marked this done after only 2 of 3 recipients.
    expect(afterChunkA.status).toBe('sending');
    expect(afterChunkA.recipient_count).toBe(totalRecipientCount);
    expect(afterChunkA.sent_count).toBe(2);

    // Chunk 1 of 2 — its own dispatchBatchId, same campaign, same true total.
    mockSendBulkSmsChunked.mockResolvedValueOnce(acceptedResponses(chunkB));
    const second = await smsService.sendBulkCampaign({
      groupId, phones: chunkB, message: 'reminder', sentBy: 'test',
      campaignId, dispatchBatchId: `${jobId}:chunk:1`, totalRecipientCount,
    });
    expect(second.sent).toBe(1);

    const [afterChunkB] = await rawQuery<{ status: string; sent_count: number; failed_count: number }>(
      `SELECT status, sent_count, failed_count FROM sms_campaigns WHERE id=$1`, [campaignId],
    );
    expect(afterChunkB.status).toBe('completed');
    expect(afterChunkB.sent_count).toBe(3);
    expect(afterChunkB.failed_count).toBe(0);
  });

  it('a QStash-retried chunk (same per-chunk dispatchBatchId) does not re-bill or re-dispatch that chunk', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('treasurer');
    await provisionBilling(groupId, 100);

    const chunkPhones = ['254700000023', '254700000024'];
    const totalRecipientCount = 5; // this chunk is 2 of a 5-recipient campaign
    const chunkKey = '55555555-5555-5555-5555-555555555555:chunk:0';

    const [{ id: campaignId }] = await rawQuery<{ id: string }>(
      `INSERT INTO sms_campaigns (group_id, name, message, created_by)
       VALUES ($1, 'Chunked campaign', 'reminder', $2) RETURNING id`,
      [groupId, officerId],
    );

    mockSendBulkSmsChunked.mockResolvedValueOnce(acceptedResponses(chunkPhones));
    const first = await smsService.sendBulkCampaign({
      groupId, phones: chunkPhones, message: 'reminder', sentBy: 'test',
      campaignId, dispatchBatchId: chunkKey, totalRecipientCount,
    });
    expect(first.sent).toBe(2);
    expect(mockSendBulkSmsChunked).toHaveBeenCalledTimes(1);

    const [afterCredits] = await rawQuery<{ sms_credits: string }>(
      `SELECT sms_credits FROM billing_accounts WHERE group_id=$1`, [groupId],
    );

    // QStash retries THIS chunk (e.g. the route timed out after dispatch but
    // before responding 2xx) — same chunk key, same phones.
    const retry = await smsService.sendBulkCampaign({
      groupId, phones: chunkPhones, message: 'reminder', sentBy: 'test',
      campaignId, dispatchBatchId: chunkKey, totalRecipientCount,
    });
    expect(retry.sent).toBe(0);
    expect(retry.failed).toBe(0);
    expect(mockSendBulkSmsChunked).toHaveBeenCalledTimes(1); // not called again

    const [afterRetryCredits] = await rawQuery<{ sms_credits: string }>(
      `SELECT sms_credits FROM billing_accounts WHERE group_id=$1`, [groupId],
    );
    expect(afterRetryCredits.sms_credits).toBe(afterCredits.sms_credits);

    // Still correctly 'sending', not prematurely 'completed' — only 2 of 5
    // total recipients have a terminal outcome (the retry deduped away, it
    // didn't count as a THIRD chunk's worth of progress).
    const [campaign] = await rawQuery<{ status: string; sent_count: number }>(
      `SELECT status, sent_count FROM sms_campaigns WHERE id=$1`, [campaignId],
    );
    expect(campaign.status).toBe('sending');
    expect(campaign.sent_count).toBe(2);
  });
});
