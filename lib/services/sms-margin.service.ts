import { withAdminDb } from '@/lib/db';
import { DEFAULT_SMS_PROVIDER } from '@/lib/sms/provider';

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
// DEFAULT_SMS_PROVIDER is a trusted compile-time constant, not caller input —
// string interpolation here is fine (no bound param needed for a value the
// query text itself hardcodes).
const COST_AT_SALE = `
  LEFT JOIN LATERAL (
    SELECT pc.unit_cost
    FROM sms_provider_costs pc
    WHERE pc.provider = '${DEFAULT_SMS_PROVIDER}'
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

/**
 * Every group's SMS revenue and consumption, highest revenue first — §15's
 * "high-volume customers", widened into the full per-group tracking view.
 *
 * LEFT JOIN sms_credits, not INNER: a group that has only ever sent on its
 * plan's bundled allowance (never bought a top-up) has zero rows in
 * sms_credits and would silently vanish from an INNER JOIN version of this
 * query — visible consumption, invisible from the revenue report. The
 * original version of this function did exactly that.
 *
 * `limit` defaults high enough to be "all groups" at the platform's current
 * real scale (5 production groups); raised well above the old default of 20
 * so this doesn't quietly start truncating again as the platform grows.
 */
export async function getTopCustomers(limit = 500): Promise<CustomerUsage[]> {
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
       LEFT JOIN sms_credits sc ON sc.group_id = g.id
       ${COST_AT_SALE}
       GROUP BY g.id, g.group_code, g.name
       ORDER BY SUM(sc.amount_paid) DESC NULLS LAST, g.name ASC
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

export interface OrganizationUsage {
  organizationId:    string;
  organizationName:  string;
  /** Message credits actually charged against this org's own wallet (payer_type='organization'). */
  creditsConsumed:   number;
  /** organization_billing_accounts.sms_credits — the pooled balance sends are gated on. */
  currentBalance:    number;
  /**
   * Real KES revenue from `organization_sms_credits` — the org-side mirror of
   * `sms_credits` (same shape: amount_paid, credits_added, rate_applied,
   * payment_id — migration 051). Included for when a purchase flow exists —
   * as of this writing there is NO code path anywhere in the app, or in any
   * migration's own seed data, that ever inserts into that table. Only
   * groups can self-serve top up via M-Pesa today; an org's current balance,
   * if nonzero, was set by hand. This is 0 for every organization now; a
   * nonzero value here later is a true positive, not a bug.
   */
  revenue:           number;
  creditsPurchased:  number;
}

/**
 * Per-organization SMS usage — the payer_organization_id axis
 * (`sms_usage_logs`, migration 051) that exists structurally alongside the
 * per-group one, for an organization that pays for a group's messages
 * centrally rather than the group paying for itself.
 *
 * Every organization is listed, not just ones with activity — an org that
 * has never touched SMS is itself information (no accidental "it's not
 * showing so I assume it's fine" reading).
 */
export async function getOrganizationUsage(): Promise<OrganizationUsage[]> {
  return withAdminDb(async (db) => {
    const { rows } = await db.query<{
      organization_id: string; organization_name: string;
      balance: string; consumed: string; revenue: string; purchased: string;
    }>(
      `SELECT o.id AS organization_id, o.name AS organization_name,
              COALESCE(oba.sms_credits, 0) AS balance,
              COALESCE((SELECT SUM(l.credits_deducted) FROM sms_usage_logs l
                         WHERE l.payer_organization_id = o.id AND l.billing_state = 'consumed'), 0) AS consumed,
              COALESCE((SELECT SUM(osc.amount_paid)   FROM organization_sms_credits osc
                         WHERE osc.organization_id = o.id), 0) AS revenue,
              COALESCE((SELECT SUM(osc.credits_added) FROM organization_sms_credits osc
                         WHERE osc.organization_id = o.id), 0) AS purchased
       FROM organizations o
       LEFT JOIN organization_billing_accounts oba ON oba.organization_id = o.id
       ORDER BY consumed DESC, o.name ASC`,
    );
    return rows.map((r) => ({
      organizationId:   r.organization_id,
      organizationName: r.organization_name,
      creditsConsumed:  Number(r.consumed),
      currentBalance:   Number(r.balance),
      revenue:          Number(r.revenue),
      creditsPurchased: Number(r.purchased),
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
                WHERE pc.provider = '${DEFAULT_SMS_PROVIDER}' AND pc.effective_to IS NULL
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
  getOrganizationUsage,
};
