import type { PoolClient } from 'pg';
import { withAdminDb } from '@/lib/db';
import { DEFAULT_SMS_PROVIDER } from '@/lib/sms/provider';

/**
 * SMS pricing — tiers, packages and provider cost, read from the database
 * rather than from code (migration 143, spec §2/§3/§15).
 *
 * This replaces `SMS_RATES` in types/enums.ts, which LOOKED like a volume
 * pricing engine — typed `(volume: number) => number` — but was not one: all
 * four call sites passed 0, and the rate actually charged at send time came
 * from `subscriptions.sms_rate`, a scalar frozen at purchase. The volume
 * argument never priced anything.
 *
 * Nothing here reprices an existing subscription. `sms_rate` stays frozen on
 * the subscription row exactly as before; these functions decide what a NEW
 * purchase costs. §4 is explicit that a completed purchase keeps its price.
 */

export interface PricingTier {
  id:          string;
  name:        string;
  minCredits:  number;
  maxCredits:  number | null;
  unitPrice:   number;
  currency:    string;
}

export interface SmsPackage {
  id:            string;
  name:          string;
  description:   string | null;
  credits:       number;
  price:         number;
  currency:      string;
  isRecommended: boolean;
}

/** Fallback if the tier table is somehow empty. Matches the seeded flat band. */
const FALLBACK_UNIT_PRICE = 0.9;

/**
 * The customer price per message for a purchase of `volume` messages.
 *
 * Reads the single active band covering that volume. `sms_tier_no_overlap`
 * guarantees at most one active band can match, so this cannot depend on row
 * order — which is exactly the property a hand-rolled CASE ladder would lack.
 */
export async function getUnitPrice(volume: number, client?: PoolClient): Promise<number> {
  const run = async (c: Pick<PoolClient, 'query'>) => {
    const { rows } = await c.query<{ unit_price: string }>(
      `SELECT unit_price FROM sms_pricing_tiers
       WHERE is_active
         AND min_credits <= $1
         AND (max_credits IS NULL OR max_credits >= $1)
       LIMIT 1`,
      [Math.max(0, Math.floor(volume))],
    );
    return rows[0] ? Number(rows[0].unit_price) : FALLBACK_UNIT_PRICE;
  };
  return client ? run(client) : withAdminDb(run);
}

/** Every active band, cheapest volume first. For a pricing table in the UI. */
export async function listActiveTiers(): Promise<PricingTier[]> {
  return withAdminDb(async (db) => {
    const { rows } = await db.query<{
      id: string; name: string; min_credits: number;
      max_credits: number | null; unit_price: string; currency: string;
    }>(
      `SELECT id, name, min_credits, max_credits, unit_price, currency
       FROM sms_pricing_tiers WHERE is_active ORDER BY display_order, min_credits`,
    );
    return rows.map((r) => ({
      id: r.id, name: r.name,
      minCredits: r.min_credits, maxCredits: r.max_credits,
      unitPrice: Number(r.unit_price), currency: r.currency,
    }));
  });
}

/**
 * Sellable bundles. §3 says prioritise these over custom quantities in the UI.
 *
 * NOTE (SMS-AUDIT-v3 G30): this function has NO CALLERS — no purchase surface
 * has ever offered a package to choose — and `sms_credits.package_id` has no
 * writer, so nothing records which package a purchase came from either. The
 * catalogue is unwired at both ends. The revenue-by-package report built over
 * that column was retired for exactly this reason; see the retirement note in
 * sms-margin.service.ts for the order in which to wire it up if the catalogue
 * is ever brought into the purchase flow.
 */
export async function listActivePackages(): Promise<SmsPackage[]> {
  return withAdminDb(async (db) => {
    const { rows } = await db.query<{
      id: string; name: string; description: string | null;
      credits: number; price: string; currency: string; is_recommended: boolean;
    }>(
      `SELECT id, name, description, credits, price, currency, is_recommended
       FROM sms_packages WHERE is_active ORDER BY display_order, credits`,
    );
    return rows.map((r) => ({
      id: r.id, name: r.name, description: r.description,
      credits: r.credits, price: Number(r.price), currency: r.currency,
      isRecommended: r.is_recommended,
    }));
  });
}

/**
 * What the provider charges us per message today.
 *
 * INTERNAL ONLY — §15 is explicit that provider cost is never exposed to
 * customers. The table it reads has RLS enabled with no policy at all, so only
 * service_role can see it; this function must never be called from a handler
 * that serialises its result into a tenant-facing response.
 */
export async function getProviderCost(
  provider = DEFAULT_SMS_PROVIDER,
  onDate?: Date,
): Promise<number | null> {
  return withAdminDb(async (db) => {
    // Date-scoped so margin on a PAST sale is computed against the cost that
    // applied then, not against whatever the provider charges now.
    const { rows } = await db.query<{ unit_cost: string }>(
      `SELECT unit_cost FROM sms_provider_costs
       WHERE provider = $1
         AND effective_from <= COALESCE($2::date, CURRENT_DATE)
         AND (effective_to IS NULL OR effective_to >= COALESCE($2::date, CURRENT_DATE))
       ORDER BY effective_from DESC
       LIMIT 1`,
      [provider, onDate ?? null],
    );
    return rows[0] ? Number(rows[0].unit_cost) : null;
  });
}

export interface Margin {
  sellPrice: number;
  unitCost:  number;
  margin:    number;
  marginPct: number;
}

/**
 * Gross margin on a sell price. Returns null when no provider cost is on
 * record — reporting "unknown" is correct, and inventing a cost to show a
 * plausible number would be worse than showing nothing.
 */
export async function marginFor(sellPrice: number, onDate?: Date): Promise<Margin | null> {
  const unitCost = await getProviderCost(DEFAULT_SMS_PROVIDER, onDate);
  if (unitCost === null) return null;
  const margin = sellPrice - unitCost;
  return {
    sellPrice,
    unitCost,
    margin,
    marginPct: sellPrice > 0 ? (margin / sellPrice) * 100 : 0,
  };
}

export const smsPricingService = {
  getUnitPrice,
  listActiveTiers,
  listActivePackages,
  getProviderCost,
  marginFor,
};
