import {
  GROUP_COLLECTION_PAYMENT_SQL,
  PAYMENT_OWNER_SQL,
  PLATFORM_INVOICE_PAYMENT_SQL,
  PLATFORM_PAYMENTS_CTE,
  PLATFORM_RECENT_PAYMENTS_SQL,
  PLATFORM_REVENUE_BY_PRODUCT_PLAN_SQL,
  PLATFORM_REVENUE_TREND_SQL,
  PLATFORM_SMS_TOPUP_PAYMENT_SQL,
  PLATFORM_SUBSCRIPTION_PAYMENT_SQL,
  canViewPlatformFinance,
  redactPlatformStatsForRole,
} from '@/lib/services/platform-revenue-classification';

describe('platform revenue classification', () => {
  it('treats subscription-linked payments as platform revenue', () => {
    expect(PLATFORM_SUBSCRIPTION_PAYMENT_SQL).toContain('subscriptions s WHERE s.payment_id = p.id');
  });

  it('treats group and organization SMS top-ups as platform revenue, via their UNIQUE payment_id', () => {
    expect(PLATFORM_SMS_TOPUP_PAYMENT_SQL).toContain('public.sms_credits sc WHERE sc.payment_id = p.id');
    expect(PLATFORM_SMS_TOPUP_PAYMENT_SQL).toContain('public.organization_sms_credits osc WHERE osc.payment_id = p.id');
  });

  it('treats invoice-settling payments as platform revenue, because invoices bill groups and organizations', () => {
    expect(PLATFORM_INVOICE_PAYMENT_SQL).toContain('inv.billing_account_id IS NOT NULL');
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

  it('counts each payment once: SMS and invoice branches exclude subscription payments, invoice also excludes SMS', () => {
    expect(PLATFORM_PAYMENTS_CTE).toContain("'sms_topup'");
    expect(PLATFORM_PAYMENTS_CTE).toContain("'invoice'");
    expect(PLATFORM_PAYMENTS_CTE).toMatch(/AND NOT \(?\s*EXISTS \(\s*SELECT 1 FROM public\.subscriptions/);
    expect(PLATFORM_PAYMENTS_CTE.match(/NOT \(?\s*EXISTS \(\s*SELECT 1 FROM public\.subscriptions/g)?.length).toBe(2);
  });

  it('attributes platform revenue by product and plan, with SMS top-ups as their own product', () => {
    expect(PLATFORM_REVENUE_BY_PRODUCT_PLAN_SQL).toContain('WITH platform_payments AS');
    expect(PLATFORM_REVENUE_BY_PRODUCT_PLAN_SQL).toMatch(/GROUP BY product, plan/);
    expect(PLATFORM_REVENUE_BY_PRODUCT_PLAN_SQL).toContain("'sms_credits'::text AS product");
  });

  it('builds the trend and billing lists from the same platform CTE, so they cannot drift', () => {
    expect(PLATFORM_REVENUE_TREND_SQL).toContain(PLATFORM_PAYMENTS_CTE);
    expect(PLATFORM_RECENT_PAYMENTS_SQL).toContain(PLATFORM_PAYMENTS_CTE);
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
