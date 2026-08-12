/**
 * Payment-gated subscription activation (migration 138) against real Postgres.
 *
 * Before this, `upgradePlan()` set status='active' on any plan with no payment
 * check at all — `billing.manage` was the only gate, so a chairperson could
 * POST /api/v1/billing/plans and land on the top tier with zero money moving.
 * The billing page ran an STK push first, but that sequencing lived entirely
 * in the client and the server never verified it.
 *
 * Integration rather than unit tests: the exactly-once guarantee is a
 * UNIQUE(payment_id) constraint plus a FOR UPDATE lock and a
 * one-active-per-product partial index, none of which a mocked pg client
 * would enforce — it would accept every assertion here while proving nothing.
 */
import { rawQuery } from './helpers/db';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { withAdminDb } from '@/lib/db';
import { billingService } from '@/lib/services/billing.service';
import { PLAN_MONTHLY_FEES } from '@/types/enums';
import type { PlanType, SubscriptionProduct } from '@/types/enums';

/** A completed M-Pesa payment plus the STK request that says what it bought. */
async function payFor(
  groupId: string,
  planType: PlanType,
  product: SubscriptionProduct,
  amount: number,
): Promise<string> {
  const suffix     = Math.random().toString(36).slice(2, 14);
  const checkoutId = `ws_CO_${suffix}`;
  await rawQuery(
    `INSERT INTO mpesa_stk_requests
       (group_id, checkout_request_id, merchant_request_id, phone, amount,
        account_reference, description, purpose, status, plan_type, product)
     VALUES ($1,$2,$3,'254700000000',$4,'SUBSCRIPT','plan','subscription','completed',$5,$6)`,
    [groupId, checkoutId, `mr_${suffix}`, amount.toFixed(2), planType, product],
  );
  const [row] = await rawQuery<{ id: string }>(
    `INSERT INTO payments
       (group_id, amount, payment_method, status, mpesa_checkout_request_id, payment_date)
     VALUES ($1,$2,'mpesa','completed',$3,NOW())
     RETURNING id`,
    [groupId, amount.toFixed(2), checkoutId],
  );
  return row.id;
}

async function activeSub(groupId: string, product: SubscriptionProduct) {
  const rows = await rawQuery<{ plan_type: string; status: string; payment_id: string | null }>(
    `SELECT plan_type, status, payment_id FROM subscriptions
     WHERE group_id = $1 AND product = $2 AND status = 'active'`,
    [groupId, product],
  );
  return rows[0] ?? null;
}

describe('payment-gated subscription activation', () => {
  let groupId: string;

  beforeEach(async () => {
    await resetDatabase();
    ({ groupId } = await createTestGroup('chairperson'));
  });

  it('activates the plan that was actually paid for', async () => {
    const fee = PLAN_MONTHLY_FEES.kitabu_yetu.growth;
    const paymentId = await payFor(groupId, 'growth', 'kitabu_yetu', fee);

    const sub = await withAdminDb((db) =>
      billingService.activateSubscriptionForPayment(db, {
        groupId, planType: 'growth', product: 'kitabu_yetu', paymentId, amountPaid: fee,
      }));

    expect(sub?.plan_type).toBe('growth');
    expect(sub?.status).toBe('active');
    expect(sub?.payment_id).toBe(paymentId);
    expect(Number(sub?.monthly_fee)).toBe(fee);
  });

  it('refuses to activate when the amount paid does not cover the plan', async () => {
    const fee = PLAN_MONTHLY_FEES.kitabu_yetu.premium;
    const paymentId = await payFor(groupId, 'premium', 'kitabu_yetu', fee - 1);

    await expect(withAdminDb((db) =>
      billingService.activateSubscriptionForPayment(db, {
        groupId, planType: 'premium', product: 'kitabu_yetu', paymentId, amountPaid: fee - 1,
      }))).rejects.toThrow(/does not cover/i);

    // Crucially the existing plan was NOT cancelled on the way to failing: the
    // fee checks run before any mutation, so a refused activation leaves the
    // group exactly where it was rather than stranding it with nothing.
    expect((await activeSub(groupId, 'kitabu_yetu'))?.plan_type).toBe('starter');
  });

  it('refuses to sell the negotiated enterprise tier through self-serve payment', async () => {
    const paymentId = await payFor(groupId, 'growth', 'kitabu_yetu', 100_000);

    await expect(withAdminDb((db) =>
      billingService.activateSubscriptionForPayment(db, {
        groupId, planType: 'enterprise', product: 'kitabu_yetu', paymentId, amountPaid: 100_000,
      }))).rejects.toThrow(/not self-serve/i);

    expect((await activeSub(groupId, 'kitabu_yetu'))?.plan_type).toBe('starter');
  });

  it('is exactly-once per payment — a replayed callback must not re-activate', async () => {
    const fee = PLAN_MONTHLY_FEES.kitabu_yetu.growth;
    const paymentId = await payFor(groupId, 'growth', 'kitabu_yetu', fee);

    const first = await withAdminDb((db) =>
      billingService.activateSubscriptionForPayment(db, {
        groupId, planType: 'growth', product: 'kitabu_yetu', paymentId, amountPaid: fee,
      }));
    expect(first).not.toBeNull();

    // Safaricom replays, or the client claims the payment the callback already
    // consumed. Must be a no-op, NOT a second subscription and NOT a
    // re-cancellation of the plan just activated.
    const second = await withAdminDb((db) =>
      billingService.activateSubscriptionForPayment(db, {
        groupId, planType: 'growth', product: 'kitabu_yetu', paymentId, amountPaid: fee,
      }));
    expect(second).toBeNull();

    const active = await rawQuery(
      `SELECT id FROM subscriptions WHERE group_id = $1 AND product = 'kitabu_yetu' AND status = 'active'`,
      [groupId],
    );
    expect(active).toHaveLength(1);
    expect((await activeSub(groupId, 'kitabu_yetu'))?.plan_type).toBe('growth');
  });

  it('one payment cannot buy two plans', async () => {
    const fee = PLAN_MONTHLY_FEES.kitabu_yetu.premium;
    const paymentId = await payFor(groupId, 'premium', 'kitabu_yetu', fee);

    await withAdminDb((db) =>
      billingService.activateSubscriptionForPayment(db, {
        groupId, planType: 'premium', product: 'kitabu_yetu', paymentId, amountPaid: fee,
      }));

    // Re-presenting the same receipt for a different plan is the obvious
    // attack once activation is driven by a payment id.
    const again = await withAdminDb((db) =>
      billingService.activateSubscriptionForPayment(db, {
        groupId, planType: 'growth', product: 'kitabu_yetu', paymentId, amountPaid: fee,
      }));
    expect(again).toBeNull();
    expect((await activeSub(groupId, 'kitabu_yetu'))?.plan_type).toBe('premium');
  });

  it('findClaimablePayment ignores payments already consumed', async () => {
    const fee = PLAN_MONTHLY_FEES.kitabu_yetu.growth;
    const paymentId = await payFor(groupId, 'growth', 'kitabu_yetu', fee);

    const before = await withAdminDb((db) =>
      billingService.findClaimablePayment(db, {
        groupId, planType: 'growth', product: 'kitabu_yetu',
      }));
    expect(before?.paymentId).toBe(paymentId);

    await withAdminDb((db) =>
      billingService.activateSubscriptionForPayment(db, {
        groupId, planType: 'growth', product: 'kitabu_yetu', paymentId, amountPaid: fee,
      }));

    const after = await withAdminDb((db) =>
      billingService.findClaimablePayment(db, {
        groupId, planType: 'growth', product: 'kitabu_yetu',
      }));
    expect(after).toBeNull();
  });

  it('will not claim a payment made for a different plan', async () => {
    await payFor(groupId, 'starter', 'kitabu_yetu', PLAN_MONTHLY_FEES.kitabu_yetu.starter);

    // Paying for starter must not be claimable as premium — otherwise the
    // cheapest plan buys the dearest one.
    const claim = await withAdminDb((db) =>
      billingService.findClaimablePayment(db, {
        groupId, planType: 'premium', product: 'kitabu_yetu',
      }));
    expect(claim).toBeNull();
  });

  it('activating one product leaves the other product untouched', async () => {
    const kyFee = PLAN_MONTHLY_FEES.kitabu_yetu.growth;
    const crFee = PLAN_MONTHLY_FEES.chama_reminder.growth;

    const crPayment = await payFor(groupId, 'growth', 'chama_reminder', crFee);
    await withAdminDb((db) =>
      billingService.activateSubscriptionForPayment(db, {
        groupId, planType: 'growth', product: 'chama_reminder', paymentId: crPayment, amountPaid: crFee,
      }));

    const kyPayment = await payFor(groupId, 'growth', 'kitabu_yetu', kyFee);
    await withAdminDb((db) =>
      billingService.activateSubscriptionForPayment(db, {
        groupId, planType: 'growth', product: 'kitabu_yetu', paymentId: kyPayment, amountPaid: kyFee,
      }));

    expect((await activeSub(groupId, 'chama_reminder'))?.plan_type).toBe('growth');
    expect((await activeSub(groupId, 'kitabu_yetu'))?.plan_type).toBe('growth');
  });

  it('prices the two products differently', () => {
    // Guards the commercial numbers themselves: these are what the callback
    // verifies a payment against, so a silent edit here sells plans at the
    // wrong price.
    expect(PLAN_MONTHLY_FEES.kitabu_yetu).toMatchObject({
      starter: 150, growth: 300, premium: 500, enterprise: 0,
    });
    expect(PLAN_MONTHLY_FEES.chama_reminder).toMatchObject({
      starter: 100, growth: 250, premium: 400, enterprise: 0,
    });
  });
});
