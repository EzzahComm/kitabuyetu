/**
 * SMS credit reservation (Phase 2a migration 123, Phase 2b bundled allowance
 * migration 124) against real Postgres.
 *
 * These are integration tests rather than unit tests on purpose: the whole
 * mechanism is a pair of SECURITY DEFINER plpgsql functions plus CHECK
 * constraints. A mocked pg client accepts invalid SQL and proves nothing —
 * the lesson recorded in sms-billing-and-dlr-scope.test.ts after C1 shipped
 * a `FOR UPDATE` that no unit test could ever have caught.
 */
import { rawQuery } from './helpers/db';
import { createTestGroup, createTestOrganization } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { settleReservation } from '@/lib/services/messaging-billing';

async function provision(groupId: string, credits: number, allowance = 50): Promise<void> {
  await rawQuery(
    `INSERT INTO billing_accounts (group_id, sms_credits)
     VALUES ($1, $2)
     ON CONFLICT (group_id) DO UPDATE SET sms_credits = EXCLUDED.sms_credits,
                                          reserved_sms_credits = 0,
                                          sms_allowance_used = 0,
                                          sms_allowance_reserved = 0`,
    [groupId, credits],
  );
  await rawQuery(
    `INSERT INTO subscriptions (group_id, plan_type, status, sms_rate, monthly_fee, sms_allowance_included)
     VALUES ($1, 'starter', 'active', 0.90, 0, $2)
     ON CONFLICT DO NOTHING`,
    [groupId, allowance],
  );
  // provision() can be called more than once per test (e.g. to re-baseline
  // credits) — the ON CONFLICT DO NOTHING above means a second call would
  // otherwise leave a stale allowance from the first call.
  await rawQuery(
    `UPDATE subscriptions SET sms_allowance_included = $2 WHERE group_id = $1 AND status = 'active'`,
    [groupId, allowance],
  );
}

async function balances(groupId: string): Promise<{
  credits: number; reserved: number; allowanceUsed: number; allowanceReserved: number;
}> {
  const [row] = await rawQuery<{
    sms_credits: string; reserved_sms_credits: string;
    sms_allowance_used: number; sms_allowance_reserved: number;
  }>(
    `SELECT sms_credits, reserved_sms_credits, sms_allowance_used, sms_allowance_reserved
     FROM billing_accounts WHERE group_id = $1`,
    [groupId],
  );
  return {
    credits:           parseFloat(row.sms_credits),
    reserved:          parseFloat(row.reserved_sms_credits),
    allowanceUsed:      row.sms_allowance_used,
    allowanceReserved:  row.sms_allowance_reserved,
  };
}

async function reserve(groupId: string, count: number, organizationId: string | null = null) {
  const [row] = await rawQuery<{
    result: {
      rate: string; total: string; remaining: string;
      fromAllowance: string; fromPaid: string;
      fromAllowanceCount: number; fromPaidCount: number;
    };
  }>(
    `SELECT reserve_sms_credits($3, $1, $4, $2) AS result`,
    [groupId, count, organizationId ? 'organization' : 'group', organizationId],
  );
  return row.result;
}

/** A log row already in the reserved state, as the send path would leave it. */
async function reservedLog(
  groupId: string, amount: number, extra: Record<string, unknown> = {}, fromAllowance = 0,
) {
  const [row] = await rawQuery<{ id: string }>(
    `INSERT INTO sms_usage_logs
       (group_id, recipient_phone, message_text, credits_deducted, credits_reserved,
        credits_from_allowance, billing_state, reserved_at, status, provider_msg_id, payer_type)
     VALUES ($1,'254700000000','t',0,$2,$3,'reserved',NOW(),$4,$5,'group')
     RETURNING id`,
    [groupId, amount, fromAllowance, extra.status ?? 'queued', extra.providerMsgId ?? null],
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
    // allowance=0 here so this file's original (pre-124) tests keep exercising
    // pure paid-credit behaviour unchanged. The bundled-allowance tests below
    // set their own allowance explicitly via provision()'s 3rd argument.
    await provision(groupId, 100, 0);
    await rawQuery(`DELETE FROM sms_usage_logs WHERE group_id = $1`, [groupId]);
  });

  describe('reserve', () => {
    it('earmarks without debiting', async () => {
      const res = await reserve(groupId, 2);
      // `total` is still MONEY — the notional cost of the send, for display
      // and logging. It is the one value here that is not a message count.
      expect(parseFloat(res.total)).toBeCloseTo(1.8, 2);

      const b = await balances(groupId);
      // The balance itself must not move — that is the difference between a
      // reservation and the debit-on-attempt this replaced.
      expect(b.credits).toBeCloseTo(100, 2);
      // Migration 144: one credit is one message, so 2 messages earmark 2 —
      // not 2 * 0.90. Earmarking money against a message-count balance is
      // what let a customer send more than they bought.
      expect(b.reserved).toBeCloseTo(2, 2);
    });

    it('refuses when available is short, counting existing earmarks', async () => {
      await provision(groupId, 1.0, 0);
      await reserve(groupId, 1); // the whole 1-message balance is now earmarked

      // Nothing available, so a second message must be refused even though
      // sms_credits alone still reads 1.00. Before migration 144 this
      // earmarked only 0.90 and left 0.10 spare — enough for the balance to
      // fund more messages than were ever paid for.
      await expect(reserve(groupId, 1)).rejects.toThrow(/insufficient/i);

      const b = await balances(groupId);
      expect(b.credits).toBeCloseTo(1.0, 2);
      expect(b.reserved).toBeCloseTo(1, 2);
    });

    it('refuses a group with no active subscription', async () => {
      const { groupId: other } = await createTestGroup('treasurer');
      await rawQuery(
        `INSERT INTO billing_accounts (group_id, sms_credits) VALUES ($1, 50)
         ON CONFLICT (group_id) DO UPDATE SET sms_credits = 50`,
        [other],
      );
      // register_group (migration 050) gives every new group an active
      // 'starter' subscription, so the no-subscription state has to be
      // induced explicitly rather than left as a fixture default.
      await rawQuery(
        `UPDATE subscriptions SET status = 'cancelled' WHERE group_id = $1`,
        [other],
      );
      await expect(reserve(other, 1)).rejects.toThrow();
    });
  });

  describe('one credit is one message (migration 144)', () => {
    it('cannot fund more messages than were bought', async () => {
      // THE REGRESSION THIS FILE EXISTS TO PREVENT.
      //
      // sms_credits was credited in MESSAGE COUNTS by the top-up path
      // (amount_paid / rate) and debited in MONEY by reserve (count * rate).
      // A group that bought exactly 100 messages could therefore reserve all
      // 100 for only 90.00, leaving 10.00 spare — enough for 11 more messages
      // nobody paid for. The error factor is 1/rate, so it grows as prices
      // fall: at the 0.50 tier the spec proposes, a customer would have
      // received double what they bought.
      //
      // If this test ever fails, revenue is leaking again.
      await provision(groupId, 100, 0); // exactly 100 messages' worth
      await reserve(groupId, 100);

      const b = await balances(groupId);
      expect(b.reserved).toBeCloseTo(100, 2);              // not 90
      expect(b.credits - b.reserved).toBeCloseTo(0, 2);    // nothing spare

      await expect(reserve(groupId, 1)).rejects.toThrow(/insufficient/i);
    });

    it('still reports the money cost of a send, which is a different thing', async () => {
      // `total` remains rate * count. Losing it would be the opposite error:
      // the balance is messages, but margin and invoicing need the money.
      await provision(groupId, 100, 0);
      const res = await reserve(groupId, 10);

      expect(parseFloat(res.total)).toBeCloseTo(9, 2);   // 10 * 0.90, money
      expect(res.fromPaidCount).toBe(10);                // messages
      expect(parseFloat(res.fromPaid)).toBeCloseTo(10, 2); // credits = messages
    });
  });

  describe('settle', () => {
    it('consume converts the earmark into a real charge', async () => {
      await reserve(groupId, 1);
      const logId = await reservedLog(groupId, 1);

      await settleReservation([logId], 'consume');

      const b = await balances(groupId);
      expect(b.credits).toBeCloseTo(99, 2);  // one message, one credit
      expect(b.reserved).toBeCloseTo(0, 2);

      const [log] = await rawQuery<{ billing_state: string; credits_deducted: string; credits_reserved: string }>(
        `SELECT billing_state, credits_deducted, credits_reserved FROM sms_usage_logs WHERE id = $1`, [logId],
      );
      expect(log.billing_state).toBe('consumed');
      expect(parseFloat(log.credits_deducted)).toBeCloseTo(1, 2);
      expect(parseFloat(log.credits_reserved)).toBeCloseTo(0, 2);
    });

    it('release returns the earmark and charges nothing', async () => {
      await reserve(groupId, 1);
      const logId = await reservedLog(groupId, 1);

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
      const logId = await reservedLog(groupId, 1);

      await settleReservation([logId], 'consume');
      await settleReservation([logId], 'consume');

      const b = await balances(groupId);
      expect(b.credits).toBeCloseTo(99, 2);
    });

    it('never drives a balance negative, so a post-send settle cannot fail', async () => {
      // A stale reservation settled after the balance moved. Unclamped this
      // raises 23514 with the SMS already sent, stranding the reservation and
      // making the sweeper retry the same failing consume forever.
      await provision(groupId, 0);
      const logId = await reservedLog(groupId, 1);

      await expect(settleReservation([logId], 'consume')).resolves.toBeDefined();

      const b = await balances(groupId);
      expect(b.credits).toBeCloseTo(0, 2);
    });
  });

  describe('bundled monthly allowance (migration 124)', () => {
    it('allowance fully covers the request, paid credits untouched', async () => {
      await provision(groupId, 100, 50);
      const res = await reserve(groupId, 5);

      expect(res.fromAllowanceCount).toBe(5);
      expect(res.fromPaidCount).toBe(0);
      expect(parseFloat(res.fromPaid)).toBeCloseTo(0, 2);
      // Message counts since migration 144, not 5 * 0.90.
      expect(parseFloat(res.fromAllowance)).toBeCloseTo(5, 2);

      const b = await balances(groupId);
      expect(b.credits).toBeCloseTo(100, 2);   // untouched
      expect(b.reserved).toBeCloseTo(0, 2);    // paid earmark untouched
      expect(b.allowanceReserved).toBe(5);
    });

    it('allowance partially covers, the remainder falls to paid credits', async () => {
      await provision(groupId, 100, 3);
      const res = await reserve(groupId, 5); // 3 from allowance, 2 from paid

      expect(res.fromAllowanceCount).toBe(3);
      expect(res.fromPaidCount).toBe(2);
      expect(parseFloat(res.fromPaid)).toBeCloseTo(2, 2);
      expect(parseFloat(res.fromAllowance)).toBeCloseTo(3, 2);

      const b = await balances(groupId);
      expect(b.reserved).toBeCloseTo(2, 2);
      expect(b.allowanceReserved).toBe(3);
    });

    it('allowance exhausted by a prior reservation falls entirely to paid', async () => {
      await provision(groupId, 100, 2);
      await reserve(groupId, 2); // exhausts the allowance (used=0 still — only advances on consume)

      const res = await reserve(groupId, 1);
      expect(res.fromAllowanceCount).toBe(0);
      expect(res.fromPaidCount).toBe(1);

      const b = await balances(groupId);
      expect(b.reserved).toBeCloseTo(1, 2);
      expect(b.allowanceReserved).toBe(2); // unchanged by the second reserve
    });

    it('allowance is gated only by its own remaining bucket, never by paid balance', async () => {
      // Paid balance alone (0.5) could not cover 3 messages at 1 credit each — but
      // every one of them is allowance-funded, so this must still succeed.
      // This is the entire point of Decision B's bundled allowance.
      await provision(groupId, 0.5, 5);
      const res = await reserve(groupId, 3);

      expect(res.fromAllowanceCount).toBe(3);
      expect(res.fromPaidCount).toBe(0);

      const b = await balances(groupId);
      expect(b.credits).toBeCloseTo(0.5, 2); // untouched
      expect(b.reserved).toBeCloseTo(0, 2);
    });

    // Real callers (sms.service.ts's send()/sendBulkCampaign()) insert ONE ROW
    // PER MESSAGE from a single reservation, each row's own credits_from_allowance
    // either 0 or exactly its own credits_reserved (never a fraction) — the
    // `allowanceLeft` counter there decides which rows are allowance-funded.
    // settle_sms_credit_reservation's allowance_count aggregates by ROW, so
    // these tests must mirror that shape, not fabricate one row for a
    // multi-message reservation.
    async function reservedLogsFor(
      groupId: string, res: { rate: string; fromAllowanceCount: number; fromPaidCount: number },
    ): Promise<string[]> {
      // One credit per message since migration 144 — the row amount is 1, not
      // the rate. res.rate is deliberately unused now; it prices the send, it
      // does not size the earmark.
      const ids: string[] = [];
      for (let i = 0; i < res.fromAllowanceCount; i++) ids.push(await reservedLog(groupId, 1, {}, 1));
      for (let i = 0; i < res.fromPaidCount; i++) ids.push(await reservedLog(groupId, 1, {}, 0));
      return ids;
    }

    it('release returns both the allowance and paid earmarks', async () => {
      await provision(groupId, 100, 3);
      const res = await reserve(groupId, 5); // 3 allowance + 2 paid
      const logIds = await reservedLogsFor(groupId, res);

      await settleReservation(logIds, 'release');

      const b = await balances(groupId);
      expect(b.credits).toBeCloseTo(100, 2);           // untouched
      expect(b.reserved).toBeCloseTo(0, 2);            // paid earmark returned
      expect(b.allowanceReserved).toBe(0);             // allowance earmark returned too
      expect(b.allowanceUsed).toBe(0);                 // never touched by a release

      const rows = await rawQuery<{ billing_state: string }>(
        `SELECT billing_state FROM sms_usage_logs WHERE id = ANY($1::uuid[])`, [logIds],
      );
      expect(rows.every((r) => r.billing_state === 'released')).toBe(true);
    });

    it('consume spends the allowance permanently, and only the paid portion debits sms_credits', async () => {
      await provision(groupId, 100, 3);
      const res = await reserve(groupId, 5); // 3 allowance + 2 paid
      const logIds = await reservedLogsFor(groupId, res);

      await settleReservation(logIds, 'consume');

      const b = await balances(groupId);
      expect(b.credits).toBeCloseTo(98, 2);    // only the 2 paid messages debited
      expect(b.reserved).toBeCloseTo(0, 2);
      expect(b.allowanceReserved).toBe(0);
      expect(b.allowanceUsed).toBe(3);         // permanently spent

      // Idempotent: settling the same already-consumed rows again must not
      // double-spend the allowance (mirrors the existing paid-side guarantee).
      await settleReservation(logIds, 'consume');
      const b2 = await balances(groupId);
      expect(b2.allowanceUsed).toBe(3);
      expect(b2.credits).toBeCloseTo(98, 2);
    });

    it('does not affect the organization branch, which has no allowance', async () => {
      const { organizationId, coordinatorId } = await createTestOrganization();
      await rawQuery(
        `INSERT INTO organization_group_access (organization_id, group_id, access_level, granted_by, is_active)
         VALUES ($1, $2, 'read', $3, true)`,
        [organizationId, groupId, coordinatorId],
      );
      await rawQuery(
        `INSERT INTO organization_billing_accounts (organization_id, sms_credits, sms_rate, is_active)
         VALUES ($1, 100, 0.90, true)
         ON CONFLICT (organization_id) DO UPDATE SET sms_credits = 100, reserved_sms_credits = 0`,
        [organizationId],
      );

      const res = await reserve(groupId, 3, organizationId);
      expect(res.fromAllowanceCount).toBe(0);
      expect(res.fromPaidCount).toBe(3);
      expect(parseFloat(res.fromAllowance)).toBeCloseTo(0, 2);

      const [org] = await rawQuery<{ sms_credits: string; reserved_sms_credits: string }>(
        `SELECT sms_credits, reserved_sms_credits FROM organization_billing_accounts WHERE organization_id = $1`,
        [organizationId],
      );
      expect(parseFloat(org.sms_credits)).toBeCloseTo(100, 2);       // untouched
      // 3 messages, 3 credits — organizations use the same one-credit-one-
      // message rule since migration 144, not 3 * their negotiated rate.
      expect(parseFloat(org.reserved_sms_credits)).toBeCloseTo(3, 2);
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
