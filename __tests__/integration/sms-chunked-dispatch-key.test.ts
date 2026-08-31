/**
 * Chunked bulk SMS with NO campaignId — the combination that was broken in
 * production and that no existing test covered.
 *
 * sendBulkCampaign resolves its dedup key as `campaignId ?? dispatchBatchId`.
 * sms-bulk-chunk-completion.test.ts passes BOTH, so the campaign id always
 * won and the malformed `${jobId}:chunk:${i}` string was never actually used
 * as the key. sms-bulk-retry-idempotency.test.ts exercises the no-campaign
 * path but passes a plain (valid) jobId. The real production combination —
 * a chunk key AND no campaign, which is what /api/v1/sms/bulk and every
 * sms_schedules occurrence produce — was therefore untested, and it failed
 * 100% of the time: the key is bound to sms_usage_logs.correlation_id and
 * .reference_id, both `uuid`, so Postgres rejected it with 22P02 on the
 * first statement. Zero rows written, zero SMS sent, and the caller had
 * already been told { queued: true }.
 *
 * These tests pin the fix: the worker derives a real uuid per chunk, stable
 * across QStash retries and distinct between siblings.
 */
import { smsService } from '@/lib/services/sms.service';
import { deriveUuid } from '@/lib/utils/uuid';
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

const JOB_ID = '77777777-7777-7777-7777-777777777777';

describe('chunked bulk send without a campaign (G1)', () => {
  beforeEach(() => {
    mockSendBulkSmsChunked.mockReset();
  });

  it('dispatches and bills a chunk keyed only by a derived per-chunk uuid', async () => {
    await resetDatabase();
    const { groupId } = await createTestGroup('treasurer');
    await provisionBilling(groupId, 100);

    const phones = ['254700000031', '254700000032'];
    // Exactly what app/api/v1/workers/sms-dispatch-chunk/route.ts now builds.
    const chunkKey = deriveUuid(JOB_ID, 'chunk:0');

    mockSendBulkSmsChunked.mockResolvedValueOnce(acceptedResponses(phones));
    const result = await smsService.sendBulkCampaign({
      groupId, phones, message: 'reminder', sentBy: 'test',
      dispatchBatchId: chunkKey, totalRecipientCount: phones.length,
      // deliberately NO campaignId — this is the production shape
    });

    // Before the fix this threw 22P02 and wrote nothing.
    expect(result.sent).toBe(2);

    const rows = await rawQuery<{ correlation_id: string; recipient_phone: string }>(
      `SELECT correlation_id, recipient_phone FROM sms_usage_logs WHERE group_id=$1 ORDER BY recipient_phone`,
      [groupId],
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.correlation_id === chunkKey)).toBe(true);
  });

  it('a QStash retry of the same chunk re-derives the key and does not re-bill or re-send', async () => {
    await resetDatabase();
    const { groupId } = await createTestGroup('treasurer');
    await provisionBilling(groupId, 100);

    const phones = ['254700000033', '254700000034'];

    mockSendBulkSmsChunked.mockResolvedValueOnce(acceptedResponses(phones));
    await smsService.sendBulkCampaign({
      groupId, phones, message: 'reminder', sentBy: 'test',
      dispatchBatchId: deriveUuid(JOB_ID, 'chunk:0'), totalRecipientCount: phones.length,
    });

    const [afterFirst] = await rawQuery<{ n: string }>(
      `SELECT count(*) AS n FROM sms_usage_logs WHERE group_id=$1`, [groupId],
    );

    // The retry recomputes the key from the same (jobId, chunkIndex).
    const retry = await smsService.sendBulkCampaign({
      groupId, phones, message: 'reminder', sentBy: 'test',
      dispatchBatchId: deriveUuid(JOB_ID, 'chunk:0'), totalRecipientCount: phones.length,
    });

    // Every recipient was already logged under this key, so the retry sends
    // nothing. Note sendBulkCampaign always returns logs: [] — the real
    // observables are the counts, the provider call, and the row count.
    expect(retry.sent).toBe(0);
    // No second dispatch to the provider, and no extra log rows.
    expect(mockSendBulkSmsChunked).toHaveBeenCalledTimes(1);
    const [afterRetry] = await rawQuery<{ n: string }>(
      `SELECT count(*) AS n FROM sms_usage_logs WHERE group_id=$1`, [groupId],
    );
    expect(afterRetry.n).toBe(afterFirst.n);
  });

  it('sibling chunks of one job do not dedupe each other away', async () => {
    await resetDatabase();
    const { groupId } = await createTestGroup('treasurer');
    await provisionBilling(groupId, 100);

    const chunk0 = ['254700000035', '254700000036'];
    const chunk1 = ['254700000037'];

    mockSendBulkSmsChunked.mockResolvedValueOnce(acceptedResponses(chunk0));
    const first = await smsService.sendBulkCampaign({
      groupId, phones: chunk0, message: 'reminder', sentBy: 'test',
      dispatchBatchId: deriveUuid(JOB_ID, 'chunk:0'), totalRecipientCount: 3,
    });

    mockSendBulkSmsChunked.mockResolvedValueOnce(acceptedResponses(chunk1));
    const second = await smsService.sendBulkCampaign({
      groupId, phones: chunk1, message: 'reminder', sentBy: 'test',
      dispatchBatchId: deriveUuid(JOB_ID, 'chunk:1'), totalRecipientCount: 3,
    });

    // Chunk 1 must NOT be deduped away by chunk 0's key: it dispatches on its
    // own, and the provider is called once per chunk.
    expect(first.sent).toBe(2);
    expect(second.sent).toBe(1);
    expect(mockSendBulkSmsChunked).toHaveBeenCalledTimes(2);

    const [{ n }] = await rawQuery<{ n: string }>(
      `SELECT count(*) AS n FROM sms_usage_logs WHERE group_id=$1`, [groupId],
    );
    expect(n).toBe('3');
  });

  it('rejects a non-uuid dispatch key at the boundary instead of failing in Postgres', async () => {
    await resetDatabase();
    const { groupId } = await createTestGroup('treasurer');
    await provisionBilling(groupId, 100);

    await expect(
      smsService.sendBulkCampaign({
        groupId, phones: ['254700000038'], message: 'reminder', sentBy: 'test',
        // The exact pre-fix shape.
        dispatchBatchId: `${JOB_ID}:chunk:0`, totalRecipientCount: 1,
      }),
    ).rejects.toThrow(/must be a UUID/);

    // Nothing was dispatched and nothing was billed.
    expect(mockSendBulkSmsChunked).not.toHaveBeenCalled();
    const [{ n }] = await rawQuery<{ n: string }>(
      `SELECT count(*) AS n FROM sms_usage_logs WHERE group_id=$1`, [groupId],
    );
    expect(n).toBe('0');
  });
});
