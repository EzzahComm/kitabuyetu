import {
  GROUP_COLLECTION_PAYMENT_SQL,
  PAYMENT_OWNER_SQL,
  PLATFORM_REVENUE_BY_PRODUCT_PLAN_SQL,
  PLATFORM_SUBSCRIPTION_PAYMENT_SQL,
  canViewPlatformFinance,
  redactPlatformStatsForRole,
} from '@/lib/services/platform-revenue-classification';

describe('platform revenue classification', () => {
  it('treats only subscription-linked payments as platform revenue', () => {
    expect(PLATFORM_SUBSCRIPTION_PAYMENT_SQL).toContain('subscriptions s WHERE s.payment_id = p.id');
  });

  it('never classifies invoice_id as platform revenue (invoices are shared with group payment accounts)', () => {
    expect(PAYMENT_OWNER_SQL).not.toContain('invoice_id');
    expect(PLATFORM_SUBSCRIPTION_PAYMENT_SQL).not.toContain('invoice_id');
  });

  it('checks the platform rule before the group rule, and falls back to unclassified', () => {
    const platformAt = PAYMENT_OWNER_SQL.indexOf("THEN 'platform'");
    const groupAt = PAYMENT_OWNER_SQL.indexOf("THEN 'group'");
    expect(platformAt).toBeGreaterThan(-1);
    expect(groupAt).toBeGreaterThan(platformAt);
    expect(PAYMENT_OWNER_SQL).toContain("ELSE 'unclassified'");
  });

  it('covers every group product table that carries a payment_id', () => {
    for (const table of ['contributions', 'loan_repayments', 'welfare_pool_contributions', 'share_transactions']) {
      expect(GROUP_COLLECTION_PAYMENT_SQL).toContain(`public.${table}`);
    }
  });

  it('attributes platform revenue by product and plan from the subscription, not the payment', () => {
    expect(PLATFORM_REVENUE_BY_PRODUCT_PLAN_SQL).toContain('s.product');
    expect(PLATFORM_REVENUE_BY_PRODUCT_PLAN_SQL).toMatch(/s\.plan_type\s+AS plan/);
    expect(PLATFORM_REVENUE_BY_PRODUCT_PLAN_SQL).toMatch(/GROUP BY s\.product, s\.plan_type/);
  });
});

describe('platform finance access', () => {
  it('lets only super_admin read platform finance', () => {
    expect(canViewPlatformFinance('super_admin')).toBe(true);
    expect(canViewPlatformFinance('support')).toBe(false);
  });
});

describe('redactPlatformStatsForRole', () => {
  const stats = {
    groups: { total: '10' },
    revenue: { total: '1000.00', this_month: '200.00', byProductPlan: [{ product: 'kitabu_yetu' }] },
    subscriptions: { active_subscriptions: '4', mrr: '5000' },
    tickets: { total: '3' },
  };

  it('returns the full payload to super_admin', () => {
    expect(redactPlatformStatsForRole(stats, 'super_admin')).toBe(stats);
  });

  it('removes revenue and MRR for support while keeping operational counts', () => {
    const out = redactPlatformStatsForRole(stats, 'support');
    expect(out).not.toHaveProperty('revenue');
    expect(out.subscriptions).not.toHaveProperty('mrr');
    expect(out.subscriptions).toHaveProperty('active_subscriptions', '4');
    expect(out.groups).toEqual({ total: '10' });
    expect(out.tickets).toEqual({ total: '3' });
  });

  it('does not mutate the cached source object', () => {
    redactPlatformStatsForRole(stats, 'support');
    expect(stats.revenue).toBeDefined();
    expect(stats.subscriptions.mrr).toBe('5000');
  });
});
