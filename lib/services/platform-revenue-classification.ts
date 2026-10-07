/**
 * Platform revenue classification for the backoffice dashboards.
 *
 * `payments.group_id` is NOT NULL, so every completed payment belongs to a
 * group, including member contributions collected through M-Pesa. Summing
 * `payments` therefore mixes group customer money into Kitabu Yetu's own
 * revenue. This module is the single place that decides which payments are
 * platform revenue, and it attributes them by product and plan.
 *
 * Classification rules (evaluated in this order):
 *   1. platform  — one of:
 *                  (a) the activation/renewal payment of a subscription
 *                      (subscriptions.payment_id), attributed to its product
 *                      and plan;
 *                  (b) an SMS credit top-up, group or organization
 *                      (sms_credits / organization_sms_credits.payment_id),
 *                      attributed to the `sms_credits` stream;
 *                  (c) a payment settling a platform invoice. Invoices are
 *                      billed by Kitabu Yetu to groups or organizations
 *                      (invoices.billing_account_id), attributed to the
 *                      `invoices` stream.
 *   2. group     — the payment is linked to a group product row
 *                  (contributions, loan_repayments, welfare_pool_contributions,
 *                  share_transactions via payment_id). Never platform revenue
 *                  unless it also matches rule 1.
 *   3. unclassified — everything else. Surfaced for reconciliation, not
 *                  counted as revenue.
 *
 * A payment matching several platform rules is counted once, in the first
 * matching stream: subscription, then SMS top-up, then invoice.
 *
 * The dashboard presents the classification; it never re-derives meaning.
 */
import type { PlatformRole } from '@/types/enums';

/** Correlated predicate: payment `p` is a subscription (platform) payment. */
export const PLATFORM_SUBSCRIPTION_PAYMENT_SQL = `EXISTS (
  SELECT 1 FROM public.subscriptions s WHERE s.payment_id = p.id
)`;

/**
 * Correlated predicate: payment `p` bought SMS credits, for a group or an
 * organization. Both credit tables have UNIQUE(payment_id), so this is exact.
 */
export const PLATFORM_SMS_TOPUP_PAYMENT_SQL = `(
  EXISTS (SELECT 1 FROM public.sms_credits sc WHERE sc.payment_id = p.id)
  OR EXISTS (SELECT 1 FROM public.organization_sms_credits osc WHERE osc.payment_id = p.id)
)`;

/**
 * Correlated predicate: payment `p` settles a platform invoice. Invoices are
 * billed by Kitabu Yetu to groups or organizations (billing_account_id), so an
 * invoice-linked payment is platform revenue.
 */
export const PLATFORM_INVOICE_PAYMENT_SQL = `(
  p.invoice_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.invoices inv
    WHERE inv.id = p.invoice_id AND inv.billing_account_id IS NOT NULL
  )
)`;

/** Correlated predicate: payment `p` is platform revenue of any stream. */
export const PLATFORM_PAYMENT_SQL = `(
  ${PLATFORM_SUBSCRIPTION_PAYMENT_SQL}
  OR ${PLATFORM_SMS_TOPUP_PAYMENT_SQL}
  OR ${PLATFORM_INVOICE_PAYMENT_SQL}
)`;

/** Correlated predicate: payment `p` is attached to a group product row. */
export const GROUP_COLLECTION_PAYMENT_SQL = `(
  EXISTS (SELECT 1 FROM public.contributions c WHERE c.payment_id = p.id)
  OR EXISTS (SELECT 1 FROM public.loan_repayments lr WHERE lr.payment_id = p.id)
  OR EXISTS (SELECT 1 FROM public.welfare_pool_contributions w WHERE w.payment_id = p.id)
  OR EXISTS (SELECT 1 FROM public.share_transactions st WHERE st.payment_id = p.id)
)`;

/** CASE expression yielding 'platform' | 'group' | 'unclassified' for payment `p`. */
export const PAYMENT_OWNER_SQL = `CASE
  WHEN ${PLATFORM_PAYMENT_SQL} THEN 'platform'
  WHEN ${GROUP_COLLECTION_PAYMENT_SQL} THEN 'group'
  ELSE 'unclassified'
END`;

export type PaymentOwner = 'platform' | 'group' | 'unclassified';

/**
 * One row per platform-classified completed payment, with its product and plan.
 * Subscription payments take product/plan from the subscription they activated
 * (the latest one if several reference the payment). SMS top-ups use the
 * `sms_credits` product and no plan. The SMS branch excludes subscription
 * payments so no payment is counted twice.
 *
 * Used with a leading WITH by the queries below.
 */
export const PLATFORM_PAYMENTS_CTE = `platform_payments AS (
  SELECT
    p.id,
    p.amount,
    p.created_at,
    s.product::text    AS product,
    s.plan_type::text  AS plan,
    'subscription'     AS stream
  FROM public.payments p
  JOIN LATERAL (
    SELECT s.product, s.plan_type FROM public.subscriptions s
    WHERE s.payment_id = p.id
    ORDER BY s.created_at DESC
    LIMIT 1
  ) s ON true
  WHERE p.status = 'completed'

  UNION ALL

  SELECT
    p.id,
    p.amount,
    p.created_at,
    'sms_credits'::text AS product,
    NULL::text          AS plan,
    'sms_topup'         AS stream
  FROM public.payments p
  WHERE p.status = 'completed'
    AND ${PLATFORM_SMS_TOPUP_PAYMENT_SQL}
    AND NOT ${PLATFORM_SUBSCRIPTION_PAYMENT_SQL}

  UNION ALL

  SELECT
    p.id,
    p.amount,
    p.created_at,
    'invoices'::text AS product,
    NULL::text       AS plan,
    'invoice'        AS stream
  FROM public.payments p
  WHERE p.status = 'completed'
    AND ${PLATFORM_INVOICE_PAYMENT_SQL}
    AND NOT ${PLATFORM_SUBSCRIPTION_PAYMENT_SQL}
    AND NOT ${PLATFORM_SMS_TOPUP_PAYMENT_SQL}
)`;

/** Platform revenue per product and plan (product includes `sms_credits`). */
export const PLATFORM_REVENUE_BY_PRODUCT_PLAN_SQL = `
  WITH ${PLATFORM_PAYMENTS_CTE}
  SELECT
    product,
    plan,
    COALESCE(SUM(amount), 0)                                                              AS total,
    COALESCE(SUM(amount) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'), 0)      AS this_month,
    COALESCE(SUM(amount) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'), 0)       AS this_week,
    COUNT(*)                                                                              AS transactions
  FROM platform_payments
  GROUP BY product, plan
  ORDER BY total DESC
`;

/** Platform revenue per month for the last six months, with a per-product split. One row per month. */
export const PLATFORM_REVENUE_TREND_SQL = `
  WITH ${PLATFORM_PAYMENTS_CTE},
  scoped AS (
    SELECT DATE_TRUNC('month', created_at) AS month_date, amount, product
    FROM platform_payments
    WHERE created_at >= NOW() - INTERVAL '6 months'
  ),
  monthly AS (
    SELECT month_date, SUM(amount) AS revenue, COUNT(*) AS transactions
    FROM scoped GROUP BY month_date
  ),
  by_product AS (
    SELECT month_date, product, SUM(amount) AS total
    FROM scoped GROUP BY month_date, product
  )
  SELECT
    TO_CHAR(m.month_date, 'Mon YYYY')  AS month,
    m.month_date                       AS month_date,
    COALESCE(m.revenue, 0)             AS revenue,
    m.transactions                     AS transactions,
    COALESCE(
      (SELECT json_object_agg(b.product, b.total) FROM by_product b WHERE b.month_date = m.month_date),
      '{}'::json
    )                                  AS by_product
  FROM monthly m
  ORDER BY m.month_date ASC
`;

/** Recent platform-classified payments for the billing overview (newest first, max 20). */
export const PLATFORM_RECENT_PAYMENTS_SQL = `
  WITH ${PLATFORM_PAYMENTS_CTE}
  SELECT p.id, p.amount, p.status, p.payment_method, p.created_at,
         g.name AS group_name, i.invoice_number,
         pp.product, pp.plan, pp.stream
  FROM platform_payments pp
  JOIN public.payments p ON p.id = pp.id
  LEFT JOIN public.groups g ON g.id = p.group_id
  LEFT JOIN public.invoices i ON i.id = p.invoice_id
  ORDER BY p.created_at DESC
  LIMIT 20
`;

/** Totals for non-platform money, so the dashboard can show it separately. */
export const PAYMENT_OWNER_TOTALS_SQL = `
  SELECT
    ${PAYMENT_OWNER_SQL}                                       AS owner,
    COALESCE(SUM(p.amount), 0)                                 AS total,
    COUNT(*)                                                   AS transactions
  FROM public.payments p
  WHERE p.status = 'completed'
  GROUP BY 1
`;

export interface ProductPlanRevenueRow {
  product: string;
  plan: string | null;
  total: string;
  this_month: string;
  this_week: string;
  transactions: string;
}

export interface PlatformRevenueSummary {
  total: string;
  this_month: string;
  this_week: string;
  byProductPlan: ProductPlanRevenueRow[];
}

export interface RedactablePlatformStats {
  revenue?: unknown;
  subscriptions?: { mrr?: unknown } & Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Least-privilege view of the platform stats payload. Only super_admin sees
 * revenue, billing and MRR. Platform support keeps operational counts and
 * ticket/activity data, but financial fields are removed rather than zeroed,
 * so a support user cannot mistake an absent figure for a real zero.
 */
export function redactPlatformStatsForRole<T extends RedactablePlatformStats>(
  stats: T,
  platformRole: PlatformRole,
): Omit<T, 'revenue'> & { revenue?: unknown } {
  if (platformRole === 'super_admin') return stats;
  const { revenue: _revenue, subscriptions, ...rest } = stats;
  const { mrr: _mrr, ...subsWithoutMrr } = subscriptions ?? {};
  return {
    ...rest,
    subscriptions: subscriptions ? subsWithoutMrr : undefined,
  } as Omit<T, 'revenue'>;
}

/** Only super_admin may read finance widgets (revenue trend, billing overview). */
export function canViewPlatformFinance(platformRole: PlatformRole): boolean {
  return platformRole === 'super_admin';
}
