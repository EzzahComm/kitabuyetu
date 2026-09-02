/**
 * Terminally-unknown delivery outcomes (SMS-REAUDIT-2026-09-02 F5).
 *
 * 151 rows sat permanently at status='sent': 112 from the C2-era backfill that
 * never set sent_at (the poller requires it), and 39 aged past the 7-day
 * window. They cost nothing and risk no money — but T3-1's closure metric
 * ("rows stuck 'sent' >7 days trends to 0") could never be satisfied, so every
 * future audit would re-flag it.
 *
 * The constraint pinned hardest here is the honest one: retiring a message
 * records that we STOPPED ASKING, not that it failed. status stays 'sent'
 * because the provider genuinely accepted it. Writing 'failed' would invent a
 * delivery failure nobody observed and corrupt every failure-rate figure
 * derived from that column.
 */
import { smsService } from '@/lib/services/sms.service';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';

const mockGetDeliveryReport = jest.fn();

jest.mock('@/lib/services/textsms.service', () => ({
  sendSingleSms: jest.fn(),
  sendBulkSms: jest.fn(),
  sendBulkSmsChunked: jest.fn(),
  getDeliveryReport: (...args: unknown[]) => mockGetDeliveryReport(...args),
  getProviderBalance: jest.fn(),
}));

/** A 'sent' message with an explicit age, as the poller sees it. */
async function seedSent(groupId: string, msgId: string, sentAtSql: string | null) {
  await rawQuery(
    `INSERT INTO sms_usage_logs
       (group_id, recipient_phone, message_text, credits_deducted, status, provider,
        provider_msg_id, sent_at)
     VALUES ($1, $2, 'hello', 0, 'sent', 'textsms', $3, ${sentAtSql ?? 'NULL'})`,
    [groupId, `2547000${msgId.slice(-6)}`, msgId],
  );
}

async function rowFor(msgId: string) {
  const [row] = await rawQuery<{ status: string; dlr_abandoned_at: Date | null }>(
    `SELECT status, dlr_abandoned_at FROM sms_usage_logs WHERE provider_msg_id = $1`, [msgId],
  );
  return row;
}

describe('terminally-unknown DLR outcomes', () => {
  let groupId: string;

  beforeEach(async () => {
    await resetDatabase();
    ({ groupId } = await createTestGroup('chairperson'));
    mockGetDeliveryReport.mockReset();
    mockGetDeliveryReport.mockResolvedValue({
      messageId: 'x', status: 'DeliveredToTerminal', statusCode: 32,
      phone: '254700000001', networkId: '1', raw: {},
    });
  });

  it('retires a message aged past the polling window', async () => {
    await seedSent(groupId, 'msg-old-1', `NOW() - INTERVAL '9 days'`);

    const r = await smsService.pollPendingDlrs();

    expect(r.abandoned).toBe(1);
    const row = await rowFor('msg-old-1');
    expect(row.dlr_abandoned_at).toBeInstanceOf(Date);
  });

  it('retires the C2-era cohort, which the poller could never see', async () => {
    // status='sent' with NO sent_at — the poller requires sent_at IS NOT NULL,
    // so these 112 rows were unreachable rather than merely old.
    await seedSent(groupId, 'msg-nulldate', null);

    const r = await smsService.pollPendingDlrs();

    expect(r.abandoned).toBe(1);
    expect((await rowFor('msg-nulldate')).dlr_abandoned_at).toBeInstanceOf(Date);
  });

  it('does NOT invent a failure — status stays sent', async () => {
    await seedSent(groupId, 'msg-old-2', `NOW() - INTERVAL '9 days'`);

    await smsService.pollPendingDlrs();

    // The provider accepted this message. We never learned whether it arrived.
    // 'failed' would be a claim nobody observed, and would skew every
    // failure-rate figure computed from this column.
    expect((await rowFor('msg-old-2')).status).toBe('sent');
  });

  it('leaves a still-pollable message alone', async () => {
    await seedSent(groupId, 'msg-fresh', `NOW() - INTERVAL '1 hour'`);

    const r = await smsService.pollPendingDlrs();

    expect(r.abandoned).toBe(0);
    expect((await rowFor('msg-fresh')).dlr_abandoned_at).toBeNull();
  });

  it('never re-polls a retired message', async () => {
    await seedSent(groupId, 'msg-old-3', `NOW() - INTERVAL '9 days'`);

    await smsService.pollPendingDlrs();
    mockGetDeliveryReport.mockClear();
    await smsService.pollPendingDlrs();

    // Retired means retired: no provider call, no budget spent, ever again.
    expect(mockGetDeliveryReport).not.toHaveBeenCalled();
  });

  it('is idempotent — a second sweep retires nothing new', async () => {
    await seedSent(groupId, 'msg-old-4', `NOW() - INTERVAL '9 days'`);

    await smsService.pollPendingDlrs();
    const second = await smsService.pollPendingDlrs();

    expect(second.abandoned).toBe(0);
  });

  it('makes the T3-1 closure metric reachable', async () => {
    await seedSent(groupId, 'msg-old-5', `NOW() - INTERVAL '9 days'`);
    await seedSent(groupId, 'msg-old-6', null);
    await seedSent(groupId, 'msg-fresh-2', `NOW() - INTERVAL '1 hour'`);

    await smsService.pollPendingDlrs();

    // "Still genuinely stuck" is now status='sent' AND dlr_abandoned_at IS NULL,
    // and the fresh row is not stuck — it is simply not due yet.
    const [{ stuck }] = await rawQuery<{ stuck: string }>(
      `SELECT COUNT(*)::text AS stuck FROM sms_usage_logs
        WHERE status = 'sent' AND dlr_abandoned_at IS NULL
          AND (sent_at IS NULL OR sent_at < NOW() - INTERVAL '7 days')`,
    );
    expect(stuck).toBe('0');
  });
});
