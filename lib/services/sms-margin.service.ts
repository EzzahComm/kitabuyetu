import { withAdminDb } from '@/lib/db';

/**
 * SMS margin and revenue reporting (spec §15). INTERNAL ONLY.
 *
 * §15: "Do not expose internal provider costs to customers." Everything in this
 * module is cost-bearing, so it must only ever be reached through a backoffice
 * route guarded by a platform role — never from a tenant surface. The
 * customer-facing equivalent is sms-analytics.service.ts, which deliberately
 * contains no cost at all.
 *
 * MARGIN IS COMPUTED PER LOT, against the provider cost that applied ON THE DAY
 * THAT LOT WAS SOLD. A single "current cost" would silently restate every past
 * month's margin the moment the provider changed price — the same mistake §4
 * forbids on the revenue side, and the reason sms_provider_costs carries
 * validity dates rather than being a column.
 */

export interface MarginSummary {
  creditsSold:  number;
  revenue:      number;
  providerCost: number;
  grossMargin:  number;
  marginPct:    number | null;
  /**
   * Credits sold in periods with no recorded provider cost. Their revenue is
   * still counted; their cost is not, so margin is UNDERSTATED by whatever
   * those cost. Surfaced rather than hidden — a margin number that quietly
   * omits part of its cost base is worse than one that says so.
   */
  creditsWithoutCost: number;
}

export interface PackageRevenue {
  packageId:   string | null;
  packageName: string | null;
  purchases:   number;
  creditsSold: number;
  revenue:     number;
  providerCost: number;
  grossMargin: number;
}

export interface CustomerUsage {
  groupId:     string;
  groupCode:   string;
  groupName:   string;
  creditsSold: number;
  revenue:     number;
  grossMargin: number;
  creditsConsumed: number;
}

export interface TierViability {
  tierId:     string;
  name:       string;
  unitPrice:  number;
  isActive:   boolean;
  providerCost: number | null;
  margin:     number | null;
  marginPct:  number | null;
  /** True when this band would sell at or below what the provider charges. */
  lossMaking: boolean;
}

/**
 * The cost that applied when a lot was sold, joined per row.
 *
 * LEFT JOIN, not INNER: a purchase made in a period with no recorded cost must
 * still contribute its revenue. Dropping it would overstate margin percentage
 * by shrinking the denominator, which is the more dangerous direction.
 */
const COST_AT_SALE = `
  LEFT JOIN LATERAL (
    SELECT pc.unit_cost
    FROM sms_provider_costs pc
    WHERE pc.provider = 'textsms'
      AND pc.effective_from <= sc.created_at::date
      AND (pc.effective_to IS NULL OR pc.effective_to >= sc.created_at::date)
    ORDER BY pc.effective_from DESC
    LIMIT 1
  ) cost ON TRUE
`;

export async function getMarginSummary(from?: string, to?: string): Promise<MarginSummary> {
  return withAdminDb(async (db) => {
    const { rows } = await db.query<{
      credits_sold: string; revenue: string; provider_cost: string; without_cost: string;
    }>(
      `SELECT
         COALESCE(SUM(sc.credits_added), 0)                        AS credits_sold,
         COALESCE(SUM(sc.amount_paid), 0)                          AS revenue,
         COALESCE(SUM(sc.credits_added * cost.unit_cost), 0)       AS provider_cost,
         COALESCE(SUM(sc.credits_added) FILTER (WHERE cost.unit_cost IS NULL), 0) AS without_cost
       FROM sms_credits sc
       ${COST_AT_SALE}
       WHERE ($1::date IS NULL OR sc.created_at::date >= $1::date)
         AND ($2::date IS NULL OR sc.created_at::date <= $2::date)`,
      [from ?? null, to ?? null],
    );

    const revenue      = Number(rows[0].revenue);
    const providerCost = Number(rows[0].provider_cost);
    const grossMargin  = revenue - providerCost;

    return {
      creditsSold:        Number(rows[0].credits_sold),
      revenue,
      providerCost,
      grossMargin,
      // Null rather than 0 on no revenue: a percentage of nothing is undefined,
      // and rendering 0% would read as "we lost everything".
      marginPct:          revenue > 0 ? (grossMargin / revenue) * 100 : null,
      creditsWithoutCost: Number(rows[0].without_cost),
    };
  });
}

export async function getRevenueByPackage(): Promise<PackageRevenue[]> {
  return withAdminDb(async (db) => {
    const { rows } = await db.query<{
      package_id: string | null; package_name: string | null;
      purchases: string; credits_sold: string; revenue: string; provider_cost: string;
    }>(
      // Custom quantities carry no package_id and group under a null row, which
      // is information — it says how much of the business bypasses the catalogue.
      `SELECT sc.package_id, p.name AS package_name,
              COUNT(*)                                            AS purchases,
              COALESCE(SUM(sc.credits_added), 0)                  AS credits_sold,
              COALESCE(SUM(sc.amount_paid), 0)                    AS revenue,
              COALESCE(SUM(sc.credits_added * cost.unit_cost), 0) AS provider_cost
       FROM sms_credits sc
       ${COST_AT_SALE}
       LEFT JOIN sms_packages p ON p.id = sc.package_id
       GROUP BY sc.package_id, p.name
       ORDER BY SUM(sc.amount_paid) DESC`,
    );
    return rows.map((r) => {
      const revenue = Number(r.revenue);
      const cost    = Number(r.provider_cost);
      return {
        packageId:    r.package_id,
        packageName:  r.package_name,
        purchases:    Number(r.purchases),
        creditsSold:  Number(r.credits_sold),
        revenue,
        providerCost: cost,
        grossMargin:  revenue - cost,
      };
    });
  });
}

/** Highest-revenue customers first — §15's "high-volume customers". */
export async function getTopCustomers(limit = 20): Promise<CustomerUsage[]> {
  return withAdminDb(async (db) => {
    const { rows } = await db.query<{
      group_id: string; group_code: string; group_name: string;
      credits_sold: string; revenue: string; provider_cost: string; consumed: string;
    }>(
      `SELECT g.id AS group_id, g.group_code, g.name AS group_name,
              COALESCE(SUM(sc.credits_added), 0)                  AS credits_sold,
              COALESCE(SUM(sc.amount_paid), 0)                    AS revenue,
              COALESCE(SUM(sc.credits_added * cost.unit_cost), 0) AS provider_cost,
              COALESCE((SELECT SUM(l.credits_deducted) FROM sms_usage_logs l
                         WHERE l.group_id = g.id AND l.billing_state = 'consumed'), 0) AS consumed
       FROM groups g
       JOIN sms_credits sc ON sc.group_id = g.id
       ${COST_AT_SALE}
       GROUP BY g.id, g.group_code, g.name
       ORDER BY SUM(sc.amount_paid) DESC
       LIMIT $1`,
      [limit],
    );
    return rows.map((r) => ({
      groupId:         r.group_id,
      groupCode:       r.group_code,
      groupName:       r.group_name,
      creditsSold:     Number(r.credits_sold),
      revenue:         Number(r.revenue),
      grossMargin:     Number(r.revenue) - Number(r.provider_cost),
      creditsConsumed: Number(r.consumed),
    }));
  });
}

/**
 * Which price bands still clear the provider's cost — §15's "loss-making
 * pricing tiers", and the check §19 asks for before trusting the bottom tier.
 *
 * Evaluates INACTIVE bands too: the point is to know whether a proposed band
 * is viable BEFORE switching to it, not to discover it afterwards.
 */
export async function getTierViability(): Promise<TierViability[]> {
  return withAdminDb(async (db) => {
    const { rows } = await db.query<{
      id: string; name: string; unit_price: string; is_active: boolean; unit_cost: string | null;
    }>(
      `SELECT t.id, t.name, t.unit_price, t.is_active,
              (SELECT pc.unit_cost FROM sms_provider_costs pc
                WHERE pc.provider = 'textsms' AND pc.effective_to IS NULL
                ORDER BY pc.effective_from DESC LIMIT 1) AS unit_cost
       FROM sms_pricing_tiers t
       ORDER BY t.display_order, t.min_credits`,
    );
    return rows.map((r) => {
      const price = Number(r.unit_price);
      const cost  = r.unit_cost === null ? null : Number(r.unit_cost);
      const margin = cost === null ? null : price - cost;
      return {
        tierId:       r.id,
        name:         r.name,
        unitPrice:    price,
        isActive:     r.is_active,
        providerCost: cost,
        margin,
        marginPct:    margin === null || price <= 0 ? null : (margin / price) * 100,
        // Unknown cost is not "safe" — but it is not a proven loss either, so
        // this stays false and marginPct stays null to say "cannot tell".
        lossMaking:   margin !== null && margin <= 0,
      };
    });
  });
}

export const smsMarginService = {
  getMarginSummary,
  getRevenueByPackage,
  getTopCustomers,
  getTierViability,
};
