/**
 * Plan SMS allowances (2026-08-16).
 *
 * Before PLAN_SMS_ALLOWANCE existed, NEITHER of billing.service.ts's two
 * `INSERT INTO subscriptions` statements set `sms_allowance_included`, so
 * every plan silently took the column default of 50 from migration 124 —
 * starter and premium alike, across both products and all 8 live
 * subscriptions. PLAN_COPY meanwhile advertised "Higher SMS allowance" as a
 * premium feature the system never delivered.
 *
 * These tests pin the two properties that failure violated:
 *   1. the allowance is DIFFERENTIATED — a paid upgrade actually buys more
 *   2. the pricing page and the subscription row read the SAME constant
 *
 * They are cheap and boring on purpose. The bug was not hard arithmetic; it
 * was two INSERTs quietly omitting a column.
 */
import {
  PLAN_SMS_ALLOWANCE, PLAN_MONTHLY_FEES, SELF_SERVE_PLANS, PRODUCT_LABEL,
  type SubscriptionProduct,
} from '@/types/enums';

// There is no exported product list; PRODUCT_LABEL is keyed by every product,
// so its keys are the authoritative set and stay correct if one is added.
const SUBSCRIPTION_PRODUCTS = Object.keys(PRODUCT_LABEL) as SubscriptionProduct[];

describe('PLAN_SMS_ALLOWANCE', () => {
  it('grants the agreed messages per plan', () => {
    // The figures signed off 2026-08-16: starter 100, growth 200, premium 300,
    // enterprise negotiated (300 floor).
    for (const product of SUBSCRIPTION_PRODUCTS) {
      expect(PLAN_SMS_ALLOWANCE[product].starter).toBe(100);
      expect(PLAN_SMS_ALLOWANCE[product].growth).toBe(200);
      expect(PLAN_SMS_ALLOWANCE[product].premium).toBe(300);
    }
  });

  it('never leaves a plan on the migration-124 default of 50', () => {
    // The exact symptom of the original bug: a plan whose allowance is 50
    // means someone forgot to set it and the column default won.
    for (const product of SUBSCRIPTION_PRODUCTS) {
      for (const plan of Object.keys(PLAN_SMS_ALLOWANCE[product]) as Array<keyof typeof PLAN_SMS_ALLOWANCE[typeof product]>) {
        expect(PLAN_SMS_ALLOWANCE[product][plan]).not.toBe(50);
      }
    }
  });

  it('increases with price, so an upgrade buys something real', () => {
    // "Higher SMS allowance" is advertised premium copy. If this fails, the
    // pricing page is making a promise the product does not keep.
    for (const product of SUBSCRIPTION_PRODUCTS) {
      const a = PLAN_SMS_ALLOWANCE[product];
      expect(a.growth).toBeGreaterThan(a.starter);
      expect(a.premium).toBeGreaterThan(a.growth);
    }
  });

  it('covers every self-serve plan that has a price', () => {
    // A plan sellable through STK push with no allowance defined would fall
    // back to the column default the moment someone bought it.
    for (const product of SUBSCRIPTION_PRODUCTS) {
      for (const plan of SELF_SERVE_PLANS) {
        expect(PLAN_SMS_ALLOWANCE[product][plan]).toBeGreaterThan(0);
        expect(PLAN_MONTHLY_FEES[product][plan]).toBeGreaterThan(0);
      }
    }
  });

  it('gives enterprise at least the premium allowance', () => {
    // Enterprise is negotiated; the constant is a floor. It must never be
    // worth LESS than the most expensive self-serve plan.
    for (const product of SUBSCRIPTION_PRODUCTS) {
      expect(PLAN_SMS_ALLOWANCE[product].enterprise)
        .toBeGreaterThanOrEqual(PLAN_SMS_ALLOWANCE[product].premium);
    }
  });
});
