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
 *   1. platform  — the payment is the activation/renewal payment of a
 *                  subscription (subscriptions.payment_id). Definitive.
 *   2. group     — the payment is linked to a group product row
 *                  (contributions, loan_repayments, welfare_pool_contributions,
 *                  share_transactions via payment_id). Never platform revenue.
 *   3. unclassified — everything else, including invoice-linked payments.
 *                  `invoices` is shared between platform billing and
 *                  group-side payment accounts (payment_accounts.kind =
 *                  'invoice'), so invoice_id cannot identify platform revenue.
 *                  These are surfaced for reconciliation, not counted as revenue.
 *
 * The dashboard presents the classification; it never re-derives meaning.
 */
import type { PlatformRole } from '@/types/enums';

/** Correlated predicate: payment `p` is a subscription (platform) payment. */
export const PLATFORM_SUBSCRIPTION_PAYMENT_SQL = `EXISTS (
  SELECT 1 FROM public.subscriptions s WHERE s.payment_id = p.id
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
  WHEN ${PLATFORM_SUBSCRIPTION_PAYMENT_SQL} THEN 'platform'
  WHEN ${GROUP_COLLECTION_PAYMENT_SQL} THEN 'group'
  ELSE 'unclassified'
END`;

export type PaymentOwner = 'platform' | 'group' | 'unclassified';

/**
 * Platform revenue per product and plan. Each platform payment is joined to
 * the subscription it activated, so product/plan come from the subscription
 * row, not from the payment.
 */
export const PLATFORM_REVENUE_BY_PRODUCT_PLAN_SQL = `
  SELECT
    s.product                                                           AS product,
    s.plan_type                                                         AS plan,
    COALESCE(SUM(p.amount), 0)                                          AS total,
    COALESCE(SUM(p.amount) FILTER (WHERE p.created_at >= NOW() - INTERVAL '30 days'), 0) AS this_month,
    COALESCE(SUM(p.amount) FILTER (WHERE p.created_at >= NOW() - INTERVAL '7 days'), 0)  AS this_week,
    COUNT(*)                                                            AS transactions
  FROM public.payments p
  JOIN LATERAL (
    SELECT s.product, s.plan_type FROM public.subscriptions s
    WHERE s.payment_id = p.id
    ORDER BY s.created_at DESC
    LIMIT 1
  ) s ON true
  WHERE p.status = 'completed'
  GROUP BY s.product, s.plan_type
  ORDER BY total DESC
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
  plan: string;
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
