/**
 * Which feature spent the credits, against real Postgres.
 *
 * `sendBulkCampaign` wrote `notification_type = 'campaign'` as a hardcoded
 * literal while the very next column, `reference_type`, carried the real
 * category. So the usage-analytics screen's per-feature breakdown — which
 * GROUP BYs `notification_type` — reported every scheduled reminder under one
 * uninformative label, for the highest-volume send path in the product and the
 * whole of Chama Reminder's mechanism.
 *
 * Nothing looked broken because nothing was missing: the rows were all there,
 * all saying the same useless thing. The only way to catch that is to assert
 * the VALUE, which is what this file does — through `handleJob('sms_bulk_send')`
 * so it exercises the same chokepoint all four bulk paths funnel through.
 *
 * See docs/audits/PRODUCT_CONCORDANCE_AUDIT_2026-08.md §2.5.
 */
import { handleJob } from '@/lib/jobs/handlers';
import { getUsageAnalytics } from '@/lib/services/sms-analytics.service';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';
import type { Job } from '@/lib/jobs/types';
import type { BulkSmsItem, BulkSmsResult } from '@/lib/services/textsms.service';

const mockSendBulkSmsChunked = jest.fn<Promise<BulkSmsResult>, [BulkSmsItem[]]>();

jest.mock('@/lib/services/textsms.service', () => ({
  sendSingleSms: jest.fn(),
  sendBulkSms: jest.fn(),
  sendBulkSmsChunked: (...args: unknown[]) => mockSendBulkSmsChunked(args[0] as BulkSmsItem[]),
  getDeliveryReport: jest.fn(),
  getProviderBalance: jest.fn(),
}));

/** Accept every item the provider was handed, so the reservation settles as consumed. */
function acceptAll(items: BulkSmsItem[]): BulkSmsResult {
  return {
    responses: items.map((item, i) => ({
      responseCode: 200, responseDescription: 'Success',
      mobile: item.mobile, messageId: `msg-${i + 1}`, networkId: '1',
      success: true, clientSmsId: item.clientSmsId as number,
    })),
    sent: items.length,
    failed: 0,
  };
}

async function provisionBilling(groupId: string): Promise<void> {
  await rawQuery(
    `INSERT INTO billing_accounts (group_id, sms_credits)
     VALUES ($1, 500)
     ON CONFLICT (group_id) DO UPDATE SET sms_credits = 500`,
    [groupId],
  );
  // Paid credits only — a bundled allowance would change which pool is drawn
  // from, and this file is about attribution, not about the split.
  await rawQuery(
    `UPDATE subscriptions SET sms_rate = 0.90, sms_allowance_included = 0
     WHERE group_id = $1 AND status = 'active'`,
    [groupId],
  );
}

async function makeBulkJob(payload: Record<string, unknown>): Promise<Job> {
  const [row] = await rawQuery<{ id: string }>(
    `INSERT INTO job_queue (type, payload, status)
     VALUES ('sms_bulk_send', $1::jsonb, 'processing') RETURNING id`,
    [JSON.stringify(payload)],
  );
  return {
    id: row.id, type: 'sms_bulk_send', payload, status: 'processing',
    attempts: 0, max_attempts: 3,
  } as unknown as Job;
}

async function featuresLogged(groupId: string): Promise<Array<{ notification_type: string | null; reference_type: string | null }>> {
  return rawQuery<{ notification_type: string | null; reference_type: string | null }>(
    `SELECT notification_type, reference_type FROM sms_usage_logs
     WHERE group_id = $1 ORDER BY created_at`,
    [groupId],
  );
}

describe('bulk SMS feature attribution', () => {
  // Same reasoning as sms-bulk-personalization.test.ts: resetDatabase() clears
  // job_queue only at the START of a test, so the last one's row would outlive
  // this file and join job-stuck-sweep.test.ts's whole-table tally.
  afterAll(async () => {
    await rawQuery(`TRUNCATE TABLE public.job_queue CASCADE`);
  });

  beforeEach(() => {
    mockSendBulkSmsChunked.mockReset();
    mockSendBulkSmsChunked.mockImplementation((items) => Promise.resolve(acceptAll(items)));
  });

  it('records the scheduled reminder as a reminder, not as a campaign', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('chairperson');
    await provisionBilling(groupId);

    // Exactly what sms-scheduler.service.ts enqueues for a due occurrence.
    await handleJob(await makeBulkJob({
      groupId, sentBy: officerId,
      phones: ['254711000001', '254711000002'],
      message: 'Meeting on Saturday.',
      referenceType: 'schedule',
      referenceId: '00000000-0000-4000-8000-000000000001',
    }));

    const rows = await featuresLogged(groupId);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      // Was 'campaign' for every one of these before the fix, while
      // reference_type beside it already knew the answer.
      expect(row.notification_type).toBe('schedule');
      expect(row.reference_type).toBe('schedule');
    }
  });

  it('still calls a campaign a campaign', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('chairperson');
    await provisionBilling(groupId);

    // The campaign routes pass no referenceType — 'campaign' is the honest
    // label there, so the fix must not relabel it.
    await handleJob(await makeBulkJob({
      groupId, sentBy: officerId,
      phones: ['254711000003'],
      message: 'End of year party!',
    }));

    const rows = await featuresLogged(groupId);
    expect(rows).toHaveLength(1);
    expect(rows[0].notification_type).toBe('campaign');
  });

  it('breaks usage down by real feature on the analytics screen', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('chairperson');
    await provisionBilling(groupId);

    await handleJob(await makeBulkJob({
      groupId, sentBy: officerId,
      phones: ['254711000001', '254711000002'],
      message: 'Contributions are due Friday.',
      referenceType: 'contribution_reminder',
      referenceId: '00000000-0000-4000-8000-000000000002',
    }));
    await handleJob(await makeBulkJob({
      groupId, sentBy: officerId,
      phones: ['254711000003'],
      message: 'Happy birthday!',
      referenceType: 'birthday',
      referenceId: '00000000-0000-4000-8000-000000000003',
    }));

    const analytics = await getUsageAnalytics(groupId);
    const byFeature = new Map(analytics.byFeature.map((f) => [f.feature, f.messages]));

    // The point of the whole exercise: two features, told apart. Before the
    // fix this was a single 'campaign' bucket of 3.
    expect(byFeature.get('contribution_reminder')).toBe(2);
    expect(byFeature.get('birthday')).toBe(1);
    expect(byFeature.has('campaign')).toBe(false);
  });
});
