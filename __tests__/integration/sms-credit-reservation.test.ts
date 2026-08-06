/**
 * SMS credit reservation (Phase 2a, migration 123) against real Postgres.
 *
 * These are integration tests rather than unit tests on purpose: the whole
 * mechanism is a pair of SECURITY DEFINER plpgsql functions plus CHECK
 * constraints. A mocked pg client accepts invalid SQL and proves nothing —
 * the lesson recorded in sms-billing-and-dlr-scope.test.ts after C1 shipped
 * a `FOR UPDATE` that no unit test could ever have caught.
 */
import { rawQuery } from './helpers/db';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { settleReservation } from '@/lib/services/messaging-billing';

async function provision(groupId: string, credits: number): Promise<void> {
  await rawQuery(
    `INSERT INTO billing_accounts (group_id, sms_credits)
     VALUES ($1, $2)
     ON CONFLICT (group_id) DO UPDATE SET sms_credits = EXCLUDED.sms_credits,
                                          reserved_sms_credits = 0`,
    [groupId, credits],
  );
  await rawQuery(
    `INSERT INTO subscriptions (group_id, plan_type, status, sms_rate, monthly_fee)
     VALUES ($1, 'starter', 'active', 0.90, 0)
     ON CONFLICT DO NOTHING`,
    [groupId],
  );
}

async function balances(groupId: string): Promise<{ credits: number; reserved: number }> {
  const [row] = await rawQuery<{ sms_credits: string; reserved_sms_credits: string }>(
    `SELECT sms_credits, reserved_sms_credits FROM billing_accounts WHERE group_id = $1`,
    [groupId],
  );
  return { credits: parseFloat(row.sms_credits), reserved: parseFloat(row.reserved_sms_credits) };
}

async function reserve(groupId: string, count: number) {
  const [row] = await rawQuery<{ result: { rate: string; total: string; remaining: string } }>(
    `SELECT reserve_sms_credits('group', $1, NULL, $2) AS result`,
    [groupId, count],
  );
  return row.result;
}

/** A log row already in the reserved state, as the send path would leave it. */
async function reservedLog(groupId: string, amount: number, extra: Record<string, unknown> = {}) {
  const [row] = await rawQuery<{ id: string }>(
    `INSERT INTO sms_usage_logs
       (group_id, recipient_phone, message_text, credits_deducted, credits_reserved,
        billing_state, reserved_at, status, provider_msg_id, payer_type)
     VALUES ($1,'254700000000','t',0,$2,'reserved',NOW(),$3,$4,'group')
     RETURNING id`,
    [groupId, amount, extra.status ?? 'queued', extra.providerMsgId ?? null],
  );
  return row.id;
}

describe('SMS credit reservation (migration 123)', () => {
  let groupId: string;

  beforeAll(async () => {
    await resetDatabase();
    ({ groupId } = await createTestGroup('treasurer'));
  });

  beforeEach(async () => {
    await provision(groupId, 100);
    await rawQuery(`DELETE FROM sms_usage_logs WHERE group_id = $1`, [groupId]);
  });

  describe('reserve', () => {
    it('earmarks without debiting', async () => {
      const res = await reserve(groupId, 2);
      expect(parseFloat(res.total)).toBeCloseTo(1.8, 2);

      const b = await balances(groupId);
      // The balance itself must not move — that is the difference between a
      // reservation and the debit-on-attempt this replaced.
      expect(b.credits).toBeCloseTo(100, 2);
      expect(b.reserved).toBeCloseTo(1.8, 2);
    });

    it('refuses when available is short, counting existing earmarks', async () => {
      await provision(groupId, 1.0);
      await reserve(groupId, 1); // 0.90 of 1.00 now earmarked

      // Only 0.10 available, so a second single message must be refused even
      // though sms_credits alone still reads 1.00.
      await expect(reserve(groupId, 1)).rejects.toThrow(/insufficient/i);

      const b = await balances(groupId);
      expect(b.credits).toBeCloseTo(1.0, 2);
      expect(b.reserved).toBeCloseTo(0.9, 2);
    });

    it('refuses a group with no active subscription', async () => {
      const { groupId: other } = await createTestGroup('treasurer');
      await rawQuery(
        `INSERT INTO billing_accounts (group_id, sms_credits) VALUES ($1, 50)
         ON CONFLICT (group_id) DO UPDATE SET sms_credits = 50`,
        [other],
      );
      await expect(reserve(other, 1)).rejects.toThrow();
    });
  });

  describe('settle', () => {
    it('consume converts the earmark into a real charge', async () => {
      await reserve(groupId, 1);
      const logId = await reservedLog(groupId, 0.9);

      await settleReservation([logId], 'consume');

      const b = await balances(groupId);
      expect(b.credits).toBeCloseTo(99.1, 2);
      expect(b.reserved).toBeCloseTo(0, 2);

      const [log] = await rawQuery<{ billing_state: string; credits_deducted: string; credits_reserved: string }>(
        `SELECT billing_state, credits_deducted, credits_reserved FROM sms_usage_logs WHERE id = $1`, [logId],
      );
      expect(log.billing_state).toBe('consumed');
      expect(parseFloat(log.credits_deducted)).toBeCloseTo(0.9, 2);
      expect(parseFloat(log.credits_reserved)).toBeCloseTo(0, 2);
    });

    it('release returns the earmark and charges nothing', async () => {
      await reserve(groupId, 1);
      const logId = await reservedLog(groupId, 0.9);

      await settleReservation([logId], 'release');

      const b = await balances(groupId);
      expect(b.credits).toBeCloseTo(100, 2);   // untouched
      expect(b.reserved).toBeCloseTo(0, 2);    // returned

      const [log] = await rawQuery<{ billing_state: string; credits_deducted: string }>(
        `SELECT billing_state, credits_deducted FROM sms_usage_logs WHERE id = $1`, [logId],
      );
      expect(log.billing_state).toBe('released');
      expect(parseFloat(log.credits_deducted)).toBeCloseTo(0, 2);
    });

    it('is idempotent — settling twice does not double charge', async () => {
      await reserve(groupId, 1);
      const logId = await reservedLog(groupId, 0.9);

      await settleReservation([logId], 'consume');
      await settleReservation([logId], 'consume');

      const b = await balances(groupId);
      expect(b.credits).toBeCloseTo(99.1, 2);
    });

    it('never drives a balance negative, so a post-send settle cannot fail', async () => {
      // A stale reservation settled after the balance moved. Unclamped this
      // raises 23514 with the SMS already sent, stranding the reservation and
      // making the sweeper retry the same failing consume forever.
      await provision(groupId, 0);
      const logId = await reservedLog(groupId, 0.9);

      await expect(settleReservation([logId], 'consume')).resolves.toBeDefined();

      const b = await balances(groupId);
      expect(b.credits).toBeCloseTo(0, 2);
    });
  });

  describe('platform-funded sends can never be billed', () => {
    it('accepts a platform row with no group and no charge', async () => {
      const [row] = await rawQuery<{ id: string; group_id: string | null }>(
        `INSERT INTO sms_usage_logs
           (group_id, recipient_phone, message_text, credits_deducted, payer_type, notification_type)
         VALUES (NULL,'254700000000','otp',0,'platform','auth_password_reset')
         RETURNING id, group_id`,
      );
      expect(row.group_id).toBeNull();
    });

    it('rejects a platform row that carries a charge', async () => {
      // The regression guard on "an OTP can never be blocked by a zero
      // balance": if billing is ever turned on globally, this fails at the
      // database rather than locking someone out of their password reset.
      await expect(
        rawQuery(
          `INSERT INTO sms_usage_logs
             (group_id, recipient_phone, message_text, credits_deducted, payer_type)
           VALUES (NULL,'254700000000','otp',0.9,'platform')`,
        ),
      ).rejects.toThrow(/sms_usage_payer_consistent/);
    });

    it('rejects a group row with no group_id', async () => {
      await expect(
        rawQuery(
          `INSERT INTO sms_usage_logs
             (group_id, recipient_phone, message_text, credits_deducted, payer_type)
           VALUES (NULL,'254700000000','x',0,'group')`,
        ),
      ).rejects.toThrow(/sms_usage_payer_consistent/);
    });
  });
});
