/**
 * SMS top-up crediting (migration 137) against real Postgres.
 *
 * Regression cover for a live production bug found 2026-08-12: the M-Pesa
 * callback credited SMS balance only inside `if (payment.invoice_id)`, but the
 * billing page never sends an invoiceId for a top-up, so the block was dead —
 * Safaricom took the money, the UI reported success, and the balance never
 * moved. One real payment was affected (receipt UH9QZ25LQG, KES 100) and had
 * to be repaired by hand.
 *
 * Integration rather than unit tests on purpose: the exactly-once guarantee is
 * a UNIQUE(payment_id) constraint plus ON CONFLICT DO NOTHING, and a mocked pg
 * client would happily accept both while proving nothing — the same lesson
 * recorded in sms-credit-reservation.test.ts.
 */
import { rawQuery } from './helpers/db';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { billingService } from '@/lib/services/billing.service';

async function provision(groupId: string): Promise<void> {
  await rawQuery(
    `INSERT INTO billing_accounts (group_id, sms_credits)
     VALUES ($1, 0)
     ON CONFLICT (group_id) DO UPDATE SET sms_credits = 0`,
    [groupId],
  );
  await rawQuery(
    `INSERT INTO subscriptions (group_id, plan_type, status, sms_rate, monthly_fee)
     VALUES ($1, 'starter', 'active', 0.90, 0)
     ON CONFLICT DO NOTHING`,
    [groupId],
  );
}

/** Creates a completed payment row to hang the credit off, as the callback would. */
async function createPayment(groupId: string, amount: number): Promise<string> {
  const [row] = await rawQuery<{ id: string }>(
    `INSERT INTO payments (group_id, amount, payment_method, status, payment_date, mpesa_receipt_number)
     VALUES ($1, $2, 'mpesa', 'completed', NOW(), $3)
     RETURNING id`,
    [groupId, amount, `SMS-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`],
  );
  return row.id;
}

async function creditBalance(groupId: string): Promise<number> {
  const [row] = await rawQuery<{ sms_credits: string }>(
    `SELECT sms_credits FROM billing_accounts WHERE group_id = $1`,
    [groupId],
  );
  return Number(row.sms_credits);
}

async function ledgerCount(paymentId: string): Promise<number> {
  const [row] = await rawQuery<{ n: string }>(`SELECT count(*) AS n FROM sms_credits WHERE payment_id = $1`, [
    paymentId,
  ]);
  return Number(row.n);
}

describe('SMS top-up crediting', () => {
  let groupId: string;
  let ctx: { userId: string; groupId: string; role: string };

  beforeEach(async () => {
    await resetDatabase();
    const g = await createTestGroup();
    groupId = g.groupId;
    ctx = { userId: 'system', groupId, role: 'chairperson' };
    await provision(groupId);
  });

  it('credits the balance at the subscription rate', async () => {
    const paymentId = await createPayment(groupId, 100);
    await billingService.addSmsCredits(ctx, 100, paymentId);

    // KES 100 at 0.90/SMS = 111.11 credits.
    expect(await creditBalance(groupId)).toBeCloseTo(111.11, 2);
    expect(await ledgerCount(paymentId)).toBe(1);
  });

  it('is exactly-once per payment — a replayed callback must not double-credit', async () => {
    const paymentId = await createPayment(groupId, 100);

    await billingService.addSmsCredits(ctx, 100, paymentId);
    const afterFirst = await creditBalance(groupId);

    // The route re-runs processFulfillment on every replayed callback
    // (handleSTKCallback computes `alreadyDone` but never returns it), and the
    // mpesa_replay_callbacks job replays every 5 minutes — so this is the
    // normal path, not an exotic one.
    await billingService.addSmsCredits(ctx, 100, paymentId);
    await billingService.addSmsCredits(ctx, 100, paymentId);

    expect(await creditBalance(groupId)).toBeCloseTo(afterFirst, 2);
    expect(await ledgerCount(paymentId)).toBe(1);
  });

  it('rejects repeated manual grants without a provider payment ID', async () => {
    await expect(billingService.addSmsCredits(ctx, 50, undefined)).rejects.toThrow(/Manual SMS-credit top-ups are disabled/i);
    await expect(billingService.addSmsCredits(ctx, 50, undefined)).rejects.toThrow(/Manual SMS-credit top-ups are disabled/i);
    expect(await creditBalance(groupId)).toBe(0);
    const [row] = await rawQuery<{ n: string }>(
      `SELECT count(*) AS n FROM sms_credits WHERE group_id = $1`,
      [groupId],
    );
    expect(Number(row.n)).toBe(0);
  });

  it('credits distinct payments independently', async () => {
    const first = await createPayment(groupId, 100);
    const second = await createPayment(groupId, 200);

    await billingService.addSmsCredits(ctx, 100, first);
    await billingService.addSmsCredits(ctx, 200, second);

    // (100 + 200) / 0.90 = 333.33
    expect(await creditBalance(groupId)).toBeCloseTo(333.33, 2);
  });
});
