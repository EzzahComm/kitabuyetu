/**
 * T3-5's operational surfaces against real Postgres (SMS-AUDIT-v3):
 * manual retry (G22), reminder history including suppressed rows (G21), and
 * the pre-send cost preview (G28).
 *
 * The closure tests these encode, verbatim from the pathway doc:
 *   - "a manual retry of an opted-out number resolves suppressed and bills
 *      nothing"
 *   - "a DSAR for one member is answerable from the UI" — i.e. one member's
 *      full reminder history, suppressed outcomes included, is retrievable
 */
import { smsService } from '@/lib/services/sms.service';
import { listReminderHistory } from '@/lib/services/reminder.service';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';

const mockSendSingleSms = jest.fn();

jest.mock('@/lib/services/textsms.service', () => ({
  sendSingleSms: (...args: unknown[]) => mockSendSingleSms(args[0]),
  sendBulkSms: jest.fn(),
  sendBulkSmsChunked: jest.fn(),
  getDeliveryReport: jest.fn(),
  getProviderBalance: jest.fn(),
}));

async function provisionBilling(groupId: string, credits: number): Promise<void> {
  await rawQuery(
    `INSERT INTO billing_accounts (group_id, sms_credits) VALUES ($1,$2)
     ON CONFLICT (group_id) DO UPDATE SET sms_credits = EXCLUDED.sms_credits`,
    [groupId, credits],
  );
  await rawQuery(`UPDATE subscriptions SET sms_allowance_included = 0 WHERE group_id = $1`, [groupId]);
  await rawQuery(
    `UPDATE billing_accounts SET sms_allowance_used = 0, sms_allowance_reserved = 0 WHERE group_id = $1`,
    [groupId],
  );
}

/** One failed send, so a retryable sms_failures row exists as production makes it. */
async function queueOneFailedSend(groupId: string, userId: string, phone = '254700000001') {
  mockSendSingleSms.mockResolvedValueOnce({
    success: false, responseDescription: 'Request failed with status code 401',
  });
  await smsService.send(
    { groupId, userId, role: 'chairperson' } as never,
    phone, 'first attempt', 'loan', null,
  );
  const [row] = await rawQuery<{ id: string }>(
    `SELECT id FROM sms_failures WHERE group_id = $1 AND NOT resolved ORDER BY created_at DESC LIMIT 1`,
    [groupId],
  );
  return row.id;
}

async function billingOf(groupId: string) {
  const [row] = await rawQuery<{ sms_credits: string }>(
    `SELECT sms_credits FROM billing_accounts WHERE group_id = $1`, [groupId],
  );
  return Number(row.sms_credits);
}

describe('T3-5 ops surfaces', () => {
  let groupId: string, officerId: string, ctx: never;

  beforeEach(async () => {
    await resetDatabase();
    ({ groupId, officerId } = await createTestGroup('chairperson'));
    mockSendSingleSms.mockReset();
    await provisionBilling(groupId, 20);
    ctx = { groupId, userId: officerId, role: 'chairperson' } as never;
  });

  // ── G22: manual retry ────────────────────────────────────────────────────

  describe('manual retry', () => {
    it('delivers and bills exactly once when the provider accepts', async () => {
      const failureId = await queueOneFailedSend(groupId, officerId);
      const before = await billingOf(groupId);

      mockSendSingleSms.mockResolvedValueOnce({ success: true, messageId: 'm-1', networkId: 'n-1' });
      const result = await smsService.retryFailure(ctx, failureId);

      expect(result.status).toBe('resolved');
      expect(await billingOf(groupId)).toBe(before - 1);

      const [log] = await rawQuery<{ status: string; billing_state: string }>(
        `SELECT status, billing_state FROM sms_usage_logs WHERE group_id = $1
         ORDER BY created_at DESC LIMIT 1`, [groupId],
      );
      expect(log.status).toBe('sent');
      expect(log.billing_state).toBe('consumed');
    });

    it('ignores the backoff — the whole point of a manual retry', async () => {
      const failureId = await queueOneFailedSend(groupId, officerId);
      // The sweep would decline this row: its next_retry_at is minutes away.
      await rawQuery(
        `UPDATE sms_failures SET next_retry_at = NOW() + INTERVAL '1 hour' WHERE id = $1`,
        [failureId],
      );

      mockSendSingleSms.mockResolvedValueOnce({ success: true, messageId: 'm-1', networkId: 'n-1' });
      const result = await smsService.retryFailure(ctx, failureId);

      expect(result.status).toBe('resolved');
    });

    it('retries a message that has already exhausted max_retries', async () => {
      const failureId = await queueOneFailedSend(groupId, officerId);
      await rawQuery(
        `UPDATE sms_failures SET retry_count = max_retries WHERE id = $1`, [failureId],
      );

      mockSendSingleSms.mockResolvedValueOnce({ success: true, messageId: 'm-1', networkId: 'n-1' });
      const result = await smsService.retryFailure(ctx, failureId);

      // Permanently failed to the sweep; a person can still say "try again".
      expect(result.status).toBe('resolved');
    });

    it('resolves an opted-out number as suppressed and bills NOTHING', async () => {
      const failureId = await queueOneFailedSend(groupId, officerId);
      await rawQuery(
        `INSERT INTO sms_opt_outs (group_id, phone, source) VALUES ($1,'254700000001','officer')`,
        [groupId],
      );
      const before = await billingOf(groupId);
      mockSendSingleSms.mockClear();

      const result = await smsService.retryFailure(ctx, failureId);

      expect(result.status).toBe('suppressed');
      expect(mockSendSingleSms).not.toHaveBeenCalled();
      expect(await billingOf(groupId)).toBe(before);

      const [row] = await rawQuery<{ resolved: boolean; failure_reason: string }>(
        `SELECT resolved, failure_reason FROM sms_failures WHERE id = $1`, [failureId],
      );
      expect(row.resolved).toBe(true);
      expect(row.failure_reason).toMatch(/opted out/);
    });

    it('refuses to re-send an already-resolved message', async () => {
      const failureId = await queueOneFailedSend(groupId, officerId);
      mockSendSingleSms.mockResolvedValueOnce({ success: true, messageId: 'm-1', networkId: 'n-1' });
      await smsService.retryFailure(ctx, failureId);

      mockSendSingleSms.mockClear();
      const second = await smsService.retryFailure(ctx, failureId);

      // A duplicate to a real person and a second charge — the pair of harms
      // the dedup work in T1-2 exists to stop.
      expect(second.status).toBe('already_resolved');
      expect(mockSendSingleSms).not.toHaveBeenCalled();
    });

    it('will not touch a failure belonging to another group', async () => {
      const failureId = await queueOneFailedSend(groupId, officerId);
      const other = await createTestGroup('chairperson');

      const result = await smsService.retryFailure(
        { groupId: other.groupId, userId: other.officerId, role: 'chairperson' } as never,
        failureId,
      );

      expect(result.status).toBe('not_found');
    });
  });

  // ── G21: reminder history ────────────────────────────────────────────────

  describe('reminder history', () => {
    async function seedDispatch(memberId: string, stage: string, status: string) {
      await rawQuery(
        `INSERT INTO reminder_dispatch_log
           (group_id, member_id, reference_type, reference_id, reminder_stage, status, channel, sent_at)
         VALUES ($1,$2,'loan_repayment',gen_random_uuid(),$3,$4::reminder_dispatch_status,'sms',
                 CASE WHEN $4 = 'sent' THEN NOW() ELSE NULL END)`,
        [groupId, memberId, stage, status],
      );
    }

    it('returns SUPPRESSED rows — the evidence an opt-out was honoured', async () => {
      await seedDispatch(officerId, 'due_3_days', 'sent');
      await seedDispatch(officerId, 'overdue_7_days', 'suppressed');

      const history = await listReminderHistory(ctx, { page: 1, limit: 20 });

      expect(history.total).toBe(2);
      expect(history.items.map((i) => i.status).sort()).toEqual(['sent', 'suppressed']);
    });

    it('answers a data-subject request: one member, every outcome', async () => {
      await seedDispatch(officerId, 'due_3_days', 'sent');
      await seedDispatch(officerId, 'overdue_7_days', 'suppressed');
      await seedDispatch(officerId, 'overdue_14_days', 'failed');

      const history = await listReminderHistory(ctx, { page: 1, limit: 50, memberId: officerId });

      expect(history.total).toBe(3);
      expect(history.items.every((i) => i.member_id === officerId)).toBe(true);
      // Named, so the answer is readable without a second lookup.
      expect(history.items[0].member_name).toBeTruthy();
    });

    it('filters by status when asked, without hiding suppressed by default', async () => {
      await seedDispatch(officerId, 'due_3_days', 'sent');
      await seedDispatch(officerId, 'overdue_7_days', 'suppressed');

      const onlySuppressed = await listReminderHistory(ctx, { page: 1, limit: 20, status: 'suppressed' });
      expect(onlySuppressed.total).toBe(1);
      expect(onlySuppressed.items[0].status).toBe('suppressed');
    });
  });

  // ── G28: pre-send cost preview ───────────────────────────────────────────

  describe('bulk send preview', () => {
    it('prices multi-segment messages per segment, not per recipient', async () => {
      const short = await smsService.previewBulkSend(ctx, {
        message: 'short',
        phones: ['254700000001', '254700000002'],
      });
      expect(short.segmentsPerMessage).toBe(1);
      expect(short.recipients).toBe(2);
      expect(short.creditsRequired).toBe(2);

      const long = await smsService.previewBulkSend(ctx, {
        message: 'x'.repeat(200), // two GSM-7 segments
        phones: ['254700000001', '254700000002'],
      });
      expect(long.segmentsPerMessage).toBe(2);
      // The number an officer would otherwise not learn until after sending.
      expect(long.creditsRequired).toBe(4);
    });

    it('excludes opted-out numbers from the count and the cost', async () => {
      await rawQuery(
        `INSERT INTO sms_opt_outs (group_id, phone, source) VALUES ($1,'254700000002','member')`,
        [groupId],
      );

      const preview = await smsService.previewBulkSend(ctx, {
        message: 'hello',
        phones: ['254700000001', '254700000002'],
      });

      expect(preview.selected).toBe(2);
      expect(preview.optedOut).toBe(1);
      expect(preview.recipients).toBe(1);
      expect(preview.creditsRequired).toBe(1);
    });

    it('counts a duplicated number once', async () => {
      const preview = await smsService.previewBulkSend(ctx, {
        message: 'hello',
        phones: ['254700000001', '254700000001'],
      });
      expect(preview.recipients).toBe(1);
      expect(preview.creditsRequired).toBe(1);
    });

    it('reports affordability against credits AND the bundled allowance', async () => {
      await rawQuery(`UPDATE billing_accounts SET sms_credits = 1 WHERE group_id = $1`, [groupId]);

      const preview = await smsService.previewBulkSend(ctx, {
        message: 'hello',
        phones: ['254700000001', '254700000002', '254700000003'],
      });

      expect(preview.creditsRequired).toBe(3);
      expect(preview.balance.available).toBe(1);
      expect(preview.affordable).toBe(false);
    });

    it('writes nothing — an abandoned preview costs the group nothing', async () => {
      const before = await billingOf(groupId);
      const [{ n: logsBefore }] = await rawQuery<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM sms_usage_logs WHERE group_id = $1`, [groupId],
      );

      await smsService.previewBulkSend(ctx, { message: 'hello', phones: ['254700000001'] });

      expect(await billingOf(groupId)).toBe(before);
      const [{ n: logsAfter }] = await rawQuery<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM sms_usage_logs WHERE group_id = $1`, [groupId],
      );
      expect(logsAfter).toBe(logsBefore);
    });
  });
});
