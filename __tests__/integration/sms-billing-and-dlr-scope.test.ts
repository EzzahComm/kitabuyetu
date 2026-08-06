/**
 * Regression tests for SMS_MESSAGING_AUDIT_2026-08.md C1 and C3, against real
 * Postgres.
 *
 * C1: debitPayer's billing lookup used a bare `FOR UPDATE` over a LEFT JOIN,
 * which PostgreSQL rejects at parse-analysis (0A000) *unconditionally* — not
 * data-dependently. Every group-funded send therefore threw before billing:
 * /sms/send, the whole trigger engine, and all bulk campaigns. Production
 * recorded the error verbatim in sms_trigger_executions.reason.
 *
 * The audit's central point was that no existing test could have caught this,
 * because nothing exercised a code path that reaches debitPayer against a real
 * database. That is what this file fixes: it is deliberately an integration
 * test rather than a unit test, since a mocked pg client would happily accept
 * the invalid SQL and prove nothing.
 *
 * C3: getDlr took a caller-supplied provider message id with no tenant scope,
 * so any officer of any group could read and mutate another group's log row.
 */
import { smsService } from '@/lib/services/sms.service';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';
import { NotFoundError } from '@/lib/utils/errors';

// The provider client is the boundary under test here only insofar as billing
// must happen before it — dispatch itself is mocked so no real SMS is sent.
jest.mock('@/lib/services/textsms.service', () => ({
  sendSingleSms: jest.fn().mockResolvedValue({
    responseCode: 200, responseDescription: 'Success',
    mobile: '254717548646', messageId: 'test-msg-1', networkId: '1', success: true,
  }),
  sendBulkSms: jest.fn().mockResolvedValue({ responses: [], sent: 0, failed: 0 }),
  sendBulkSmsChunked: jest.fn().mockResolvedValue({ responses: [], sent: 0, failed: 0 }),
  getDeliveryReport: jest.fn().mockResolvedValue({
    messageId: 'test-msg-1', phone: '254717548646',
    status: 'DeliveredToTerminal', networkId: '1',
    deliveredAt: '2026-08-06 12:00:00', raw: {},
  }),
  getProviderBalance: jest.fn().mockResolvedValue({ balance: 100, currency: 'KES', raw: {} }),
}));

/** Give a group the billing state a group-funded send requires. */
async function provisionBilling(groupId: string, credits: number): Promise<void> {
  await rawQuery(
    `INSERT INTO billing_accounts (group_id, sms_credits)
     VALUES ($1, $2)
     ON CONFLICT (group_id) DO UPDATE SET sms_credits = EXCLUDED.sms_credits`,
    [groupId, credits],
  );
  await rawQuery(
    `INSERT INTO subscriptions (group_id, plan_type, status, sms_rate, monthly_fee)
     VALUES ($1, 'starter', 'active', 0.90, 0)
     ON CONFLICT DO NOTHING`,
    [groupId],
  );
}

describe('SMS billing path (C1) and DLR tenant scope (C3)', () => {
  let groupId: string, officerId: string;

  beforeAll(async () => {
    await resetDatabase();
    const g = await createTestGroup('treasurer');
    groupId   = g.groupId;
    officerId = g.officerId;
    await provisionBilling(groupId, 100);
  });

  describe('C1 — the group billing lookup executes and debits', () => {
    it('sends, debits credits, and writes a usage log row', async () => {
      const ctx = { userId: officerId, groupId, role: 'treasurer' };

      const logs = await smsService.send(ctx, '0717548646', 'hello');

      // Before the fix this threw 0A000 and never reached any assertion.
      expect(logs).toHaveLength(1);
      expect(logs[0].group_id).toBe(groupId);

      const [billing] = await rawQuery<{ sms_credits: string }>(
        `SELECT sms_credits FROM billing_accounts WHERE group_id=$1`, [groupId],
      );
      // 100 - (0.90 * 1 recipient)
      expect(parseFloat(billing.sms_credits)).toBeCloseTo(99.1, 2);

      const [log] = await rawQuery<{ credits_deducted: string; payer_type: string }>(
        `SELECT credits_deducted, payer_type FROM sms_usage_logs WHERE group_id=$1`, [groupId],
      );
      expect(parseFloat(log.credits_deducted)).toBeCloseTo(0.9, 2);
      expect(log.payer_type).toBe('group');
    });

    it('rejects a send when the group cannot afford it, without writing a log row', async () => {
      const { groupId: poorGroup, officerId: poorOfficer } = await createTestGroup('treasurer');
      await provisionBilling(poorGroup, 0.1);

      await expect(
        smsService.send(
          { userId: poorOfficer, groupId: poorGroup, role: 'treasurer' },
          '0717548646', 'hello',
        ),
      ).rejects.toThrow();

      const rows = await rawQuery(
        `SELECT 1 FROM sms_usage_logs WHERE group_id=$1`, [poorGroup],
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('C3 — getDlr is scoped to the calling tenant', () => {
    it("refuses a message id belonging to another group", async () => {
      const [log] = await rawQuery<{ id: string }>(
        `UPDATE sms_usage_logs SET provider_msg_id='foreign-msg-1', status='sent', sent_at=NOW()
         WHERE group_id=$1 RETURNING id`,
        [groupId],
      );
      expect(log).toBeDefined();

      const { groupId: otherGroup } = await createTestGroup('treasurer');

      await expect(
        smsService.getDlr('foreign-msg-1', { groupId: otherGroup }),
      ).rejects.toThrow(NotFoundError);

      // and the foreign row must be untouched by the attempt
      const [after] = await rawQuery<{ status: string }>(
        `SELECT status FROM sms_usage_logs WHERE provider_msg_id='foreign-msg-1'`,
      );
      expect(after.status).toBe('sent');
    });

    it('allows the owning group, and applies the delivery result', async () => {
      const result = await smsService.getDlr('foreign-msg-1', { groupId });
      expect(result.status).toBe('delivered');

      const [after] = await rawQuery<{ status: string }>(
        `SELECT status FROM sms_usage_logs WHERE provider_msg_id='foreign-msg-1'`,
      );
      expect(after.status).toBe('delivered');
    });

    it('allows the system/cron scope across tenants', async () => {
      const result = await smsService.getDlr('foreign-msg-1', { system: true });
      expect(result.status).toBe('delivered');
    });
  });
});
