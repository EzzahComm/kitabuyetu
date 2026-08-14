/**
 * SMS usage analytics (§8) and margin reporting (§15) against real Postgres.
 *
 * Phase 5 of docs/audits/SMS_MONETIZATION_AUDIT_2026-08.md. Two surfaces that
 * must not blur into each other:
 *
 *   - getUsageAnalytics is TENANT-FACING and carries no provider cost at all.
 *   - getMarginSummary et al are INTERNAL and are entirely about cost.
 *
 * §15: "Do not expose internal provider costs to customers." The last test in
 * this file is the one that enforces that boundary; everything else checks the
 * arithmetic.
 */
import { getUsageAnalytics } from '@/lib/services/sms-analytics.service';
import { smsMarginService } from '@/lib/services/sms-margin.service';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';

/** A purchase at a given rate, `daysAgo` in the past. */
async function purchase(groupId: string, credits: number, rate: number, daysAgo = 0) {
  await rawQuery(
    `INSERT INTO sms_credits
       (group_id, billing_account_id, amount_paid, credits_added, remaining_credits,
        rate_applied, created_at)
     SELECT $1, ba.id, $2, $3, $3, $4, NOW() - ($5 || ' days')::interval
     FROM billing_accounts ba WHERE ba.group_id = $1`,
    [groupId, (credits * rate).toFixed(2), credits.toFixed(2), rate.toFixed(4), daysAgo],
  );
  await rawQuery(
    `UPDATE billing_accounts SET sms_credits = sms_credits + $1 WHERE group_id = $2`,
    [credits.toFixed(2), groupId],
  );
}

/** A settled (consumed) message, optionally attributed to a feature. */
async function consumed(
  groupId: string, credits: number, opts: { feature?: string | null; daysAgo?: number } = {},
) {
  await rawQuery(
    `INSERT INTO sms_usage_logs
       (group_id, recipient_phone, message_text, status, credits_deducted,
        payer_type, billing_state, credits_reserved, credits_from_allowance,
        notification_type, settled_at, created_at)
     VALUES ($1,'254700000001','t','sent',$2,'group','consumed',0,0,$3,
             NOW() - ($4 || ' days')::interval, NOW() - ($4 || ' days')::interval)`,
    [groupId, credits.toFixed(4), opts.feature ?? null, opts.daysAgo ?? 0],
  );
  await rawQuery(
    `UPDATE billing_accounts SET sms_credits = GREATEST(sms_credits - $1, 0) WHERE group_id = $2`,
    [credits.toFixed(4), groupId],
  );
}

describe('SMS usage analytics (§8)', () => {
  let groupId: string;

  beforeEach(async () => {
    await resetDatabase();
    ({ groupId } = await createTestGroup('chairperson'));
    await rawQuery(`UPDATE billing_accounts SET sms_credits = 0 WHERE group_id = $1`, [groupId]);
  });

  it('reports purchases, consumption and balance', async () => {
    await purchase(groupId, 1000, 0.90);
    await consumed(groupId, 40);

    const a = await getUsageAnalytics(groupId);
    expect(a.creditsPurchased).toBe(1000);
    expect(a.creditsConsumed).toBe(40);
    expect(a.balance).toBe(960);
  });

  it('separates this month from last month', async () => {
    await purchase(groupId, 1000, 0.90);
    await consumed(groupId, 10, { daysAgo: 0 });
    await consumed(groupId, 25, { daysAgo: 45 }); // safely in a prior month

    const a = await getUsageAnalytics(groupId);
    expect(a.usageThisMonth).toBe(10);
    // 45 days back can be two months ago depending on where in the month we
    // are, so assert only that it is not counted as current.
    expect(a.usageThisMonth).not.toBe(35);
  });

  it('counts only consumed messages, never reserved or released ones', async () => {
    // A reservation is not a spend, and a release never was. Counting either
    // would tell a customer they had used credits they still hold.
    await purchase(groupId, 100, 0.90);
    await rawQuery(
      `INSERT INTO sms_usage_logs
         (group_id, recipient_phone, message_text, status, credits_deducted,
          payer_type, billing_state, credits_reserved, credits_from_allowance)
       VALUES ($1,'254700000002','t','queued',0,'group','reserved',5,0),
              ($1,'254700000003','t','failed',0,'group','released',0,0)`,
      [groupId],
    );

    const a = await getUsageAnalytics(groupId);
    expect(a.creditsConsumed).toBe(0);
  });

  it('projects burn rate and days remaining once there is usage', async () => {
    await purchase(groupId, 1000, 0.90);
    // 300 credits over the trailing 30-day window => 10/day.
    for (let i = 0; i < 3; i++) await consumed(groupId, 100, { daysAgo: i });

    const a = await getUsageAnalytics(groupId);
    expect(a.projectedMonthly).toBeCloseTo(300, 0); // 10/day * 30
    expect(a.daysRemaining).toBe(70);              // 700 left / 10 per day
  });

  it('reports no projection for a group that has never sent, rather than zero days', async () => {
    // "0 days remaining" on an idle group reads as an alarm. Null says
    // "nothing to project from", which is the truth.
    await purchase(groupId, 500, 0.90);

    const a = await getUsageAnalytics(groupId);
    expect(a.projectedMonthly).toBeNull();
    expect(a.daysRemaining).toBeNull();
  });

  it('breaks usage down by feature and flags unattributed history', async () => {
    await purchase(groupId, 1000, 0.90);
    await consumed(groupId, 30, { feature: 'contribution_nudge' });
    await consumed(groupId, 20, { feature: 'birthday' });
    await consumed(groupId, 50, { feature: null }); // predates attribution

    const a = await getUsageAnalytics(groupId);
    const byFeature = Object.fromEntries(a.byFeature.map((f) => [f.feature ?? 'null', f.credits]));
    expect(byFeature['contribution_nudge']).toBe(30);
    expect(byFeature['birthday']).toBe(20);

    // ~95% of real production rows have no notification_type because the
    // column postdates them. The UI has to say "unattributed" rather than
    // implying those sends were free or deliberately uncategorised.
    expect(a.hasUnattributedHistory).toBe(true);
    expect(byFeature['null']).toBe(50);
  });

  it('costs usage at the GROUP\'S rate, which is what they pay', async () => {
    await purchase(groupId, 1000, 0.90);
    await consumed(groupId, 100);

    const a = await getUsageAnalytics(groupId);
    // createTestGroup provisions a 0.90 subscription.
    expect(a.costThisMonth).toBeCloseTo(90, 2);
  });
});

/**
 * Restore the pricing/cost configuration migration 143 seeds.
 *
 * sms_provider_costs and sms_pricing_tiers are CONFIGURATION, so
 * resetDatabase() does not truncate them — which means a test that retires a
 * cost or adds a tier leaks that change into every later test, into other
 * suites, and into the next run. The pricing suite learned this the hard way;
 * this file mutates both, so it cleans up after itself explicitly.
 */
async function restorePricingConfig(): Promise<void> {
  await rawQuery(`DELETE FROM sms_pricing_tiers WHERE name = 'Underwater'`);
  await rawQuery(`DELETE FROM sms_provider_costs WHERE provider = 'textsms' AND unit_cost <> 0.3500`);
  await rawQuery(
    `UPDATE sms_provider_costs
     SET effective_from = CURRENT_DATE - 365, effective_to = NULL, unit_cost = 0.3500
     WHERE provider = 'textsms'`,
  );
}

describe('SMS margin reporting (§15)', () => {
  let groupId: string;

  beforeEach(async () => {
    await resetDatabase();
    ({ groupId } = await createTestGroup('chairperson'));
    await rawQuery(`UPDATE billing_accounts SET sms_credits = 0 WHERE group_id = $1`, [groupId]);
    await restorePricingConfig();
  });

  afterAll(restorePricingConfig);

  it('computes revenue, cost and margin from real purchases', async () => {
    await purchase(groupId, 1000, 0.90); // KES 900 revenue, 1000 credits

    const m = await smsMarginService.getMarginSummary();
    expect(m.creditsSold).toBe(1000);
    expect(m.revenue).toBeCloseTo(900, 2);
    expect(m.providerCost).toBeCloseTo(350, 2);   // 1000 * 0.35
    expect(m.grossMargin).toBeCloseTo(550, 2);
    expect(m.marginPct).toBeCloseTo(61.1, 1);
  });

  it('prices each lot against the cost in force WHEN IT WAS SOLD', async () => {
    // The whole reason sms_provider_costs carries validity dates. If margin
    // used a single current cost, every provider price change would silently
    // restate history — the same mistake §4 forbids on the revenue side.
    await rawQuery(
      `UPDATE sms_provider_costs SET effective_to = CURRENT_DATE - 10 WHERE provider = 'textsms'`,
    );
    await rawQuery(
      `INSERT INTO sms_provider_costs (provider, unit_cost, effective_from)
       VALUES ('textsms', 0.5000, CURRENT_DATE - 9)`,
    );

    await purchase(groupId, 100, 0.90, 20); // sold under the OLD 0.35 cost
    await purchase(groupId, 100, 0.90, 1);  // sold under the NEW 0.50 cost

    const m = await smsMarginService.getMarginSummary();
    // 100*0.35 + 100*0.50 = 85, not 200*0.50 = 100 nor 200*0.35 = 70.
    expect(m.providerCost).toBeCloseTo(85, 2);
  });

  it('counts revenue but flags credits sold with no recorded cost', async () => {
    // Understating cost overstates margin. Surfacing the gap beats silently
    // producing a number that looks better than reality.
    await rawQuery(
      `UPDATE sms_provider_costs SET effective_from = CURRENT_DATE - 1 WHERE provider = 'textsms'`,
    );
    await purchase(groupId, 200, 0.90, 30); // predates any recorded cost

    const m = await smsMarginService.getMarginSummary();
    expect(m.revenue).toBeCloseTo(180, 2);      // revenue still counted
    expect(m.creditsWithoutCost).toBe(200);     // and the gap is visible
  });

  it('returns null margin percentage on no revenue, not zero', async () => {
    const m = await smsMarginService.getMarginSummary();
    expect(m.revenue).toBe(0);
    expect(m.marginPct).toBeNull(); // 0% would read as "we lost everything"
  });

  it('ranks customers by revenue', async () => {
    await purchase(groupId, 1000, 0.90);
    const top = await smsMarginService.getTopCustomers();
    expect(top[0].groupId).toBe(groupId);
    expect(top[0].revenue).toBeCloseTo(900, 2);
    expect(top[0].grossMargin).toBeCloseTo(550, 2);
  });

  it('identifies which price bands clear the provider cost', async () => {
    const tiers = await smsMarginService.getTierViability();
    const floor = tiers.find((t) => t.unitPrice === 0.5);

    // §19 warned not to assume 0.50 is sustainable. At a 0.35 cost it is —
    // 30% gross — so it is viable, not loss-making.
    expect(floor).toBeDefined();
    expect(floor!.lossMaking).toBe(false);
    expect(floor!.marginPct).toBeCloseTo(30, 1);

    // Inactive bands are evaluated too: the point is to know a band is viable
    // BEFORE switching to it.
    expect(tiers.some((t) => !t.isActive)).toBe(true);
  });

  it('marks a band that sells at or below cost as loss-making', async () => {
    await rawQuery(
      `INSERT INTO sms_pricing_tiers (name, min_credits, max_credits, unit_price, is_active)
       VALUES ('Underwater', 0, 100, 0.3000, false)`,
    );
    const tiers = await smsMarginService.getTierViability();
    expect(tiers.find((t) => t.name === 'Underwater')!.lossMaking).toBe(true);
  });

  it('NEVER leaks provider cost into the tenant-facing surface (§15)', async () => {
    // The boundary this whole split exists to hold. If a cost field ever
    // appears here, a customer can read what Kitabu Yetu pays.
    await purchase(groupId, 1000, 0.90);
    await consumed(groupId, 100);

    const a = await getUsageAnalytics(groupId);
    const serialised = JSON.stringify(a);

    expect(serialised).not.toMatch(/providerCost|unit_cost|unitCost|margin/i);
    expect(Object.keys(a)).not.toContain('providerCost');
    // 0.35 is the provider cost; 90 (100 * the group's own 0.90) is theirs to see.
    expect(serialised).not.toContain('0.35');
    expect(a.costThisMonth).toBeCloseTo(90, 2);
  });
});
