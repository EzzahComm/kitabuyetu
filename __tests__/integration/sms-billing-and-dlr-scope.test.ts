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
import { assignGroupMemberRole } from '@/lib/services/member-roles.service';
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

/**
 * Give a group the billing state a group-funded send requires.
 *
 * allowance defaults to 0 (not the column's own DEFAULT 50, migration 124) so
 * this file's C1/C3 tests keep exercising pure paid-credit behaviour — the
 * Decision B flip is proven separately, with its own explicit allowance,
 * below.
 */
async function provisionBilling(groupId: string, credits: number, allowance = 0): Promise<void> {
  await rawQuery(
    `INSERT INTO billing_accounts (group_id, sms_credits)
     VALUES ($1, $2)
     ON CONFLICT (group_id) DO UPDATE SET sms_credits = EXCLUDED.sms_credits`,
    [groupId, credits],
  );
  await rawQuery(
    `INSERT INTO subscriptions (group_id, plan_type, status, sms_rate, monthly_fee, sms_allowance_included)
     VALUES ($1, 'starter', 'active', 0.90, 0, $2)
     ON CONFLICT DO NOTHING`,
    [groupId, allowance],
  );
  await rawQuery(
    `UPDATE subscriptions SET sms_allowance_included = $2 WHERE group_id = $1 AND status = 'active'`,
    [groupId, allowance],
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
      // 100 - 1 recipient. Was 99.1 (100 - 0.90 * 1) until migration 144:
      // the balance is a MESSAGE COUNT, so charging it the money rate let a
      // group send more messages than it bought.
      expect(parseFloat(billing.sms_credits)).toBeCloseTo(99, 2);

      const [log] = await rawQuery<{ credits_deducted: string; payer_type: string }>(
        `SELECT credits_deducted, payer_type FROM sms_usage_logs WHERE group_id=$1`, [groupId],
      );
      // One message, one credit (migration 144). The money cost of this send
      // is still derivable as credits * the subscription's sms_rate; it is
      // just no longer what the balance moves by.
      expect(parseFloat(log.credits_deducted)).toBeCloseTo(1, 2);
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

  describe('Decision B — a real notifyMember call site actually bills (Phase 2b, migration 124)', () => {
    it('assignGroupMemberRole bills the role-change notice via the bundled allowance', async () => {
      const { groupId: rgGroupId, officerId } = await createTestGroup('treasurer');
      await provisionBilling(rgGroupId, 100, 50);

      const [before] = await rawQuery<{ sms_allowance_used: number }>(
        `SELECT sms_allowance_used FROM billing_accounts WHERE group_id=$1`, [rgGroupId],
      );

      const [{ id: memberRoleId }] = await rawQuery<{ id: string }>(
        `SELECT id FROM public.roles WHERE group_id IS NULL AND code = 'member'`,
      );

      await assignGroupMemberRole({
        actorId: officerId, memberId: officerId, groupId: rgGroupId, roleId: memberRoleId,
      });

      // Proves the Decision B flip actually took effect: before this PR,
      // member-roles.service.ts's notifyMember call defaulted to
      // billingMode 'unbilled' and never moved this counter at all.
      const [after] = await rawQuery<{ sms_allowance_used: number; sms_allowance_reserved: number }>(
        `SELECT sms_allowance_used, sms_allowance_reserved FROM billing_accounts WHERE group_id=$1`, [rgGroupId],
      );
      expect(after.sms_allowance_used).toBe(before.sms_allowance_used + 1);
      // settleReservation runs synchronously inside sendSmsLeg's finally,
      // awaited before assignGroupMemberRole returns — nothing left earmarked.
      expect(after.sms_allowance_reserved).toBe(0);

      const [log] = await rawQuery<{ payer_type: string; billing_state: string }>(
        `SELECT payer_type, billing_state FROM sms_usage_logs
         WHERE group_id=$1 AND reference_type='role_assignment'
         ORDER BY created_at DESC LIMIT 1`,
        [rgGroupId],
      );
      expect(log.payer_type).toBe('group');
      // No longer the old hardcoded credits_deducted=0/billing_state='none'
      // shape this call site had before the flip.
      expect(log.billing_state).toBe('consumed');
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
