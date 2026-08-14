import type { PoolClient } from 'pg';
import { withAdminDb } from '@/lib/db';
import { ValidationError, NotFoundError } from '@/lib/utils/errors';

/**
 * Super-admin control over SMS pricing (spec §12). INTERNAL ONLY.
 *
 * Every mutation here writes an audit_logs row — §12 ends with "All changes
 * should be auditable", and a price change with no record of who made it is
 * the one kind of change you most want to be able to trace.
 *
 * Reads live in sms-pricing.service.ts (used on the hot path by billing) and
 * sms-margin.service.ts (reporting). This module only writes.
 */

/**
 * Row shapes for the three pricing tables (migration 143), snake_case exactly
 * as Postgres returns them. Declared here so `getPricingConfig()`'s return type
 * is real rather than `any[]`, which is what lets the admin screen derive its
 * types from this service instead of hand-writing a parallel set that drifts —
 * the same failure `CLIENT_SERVER_CONTRACT_AUDIT_2026-08.md` catalogued.
 *
 * NUMERIC columns arrive as strings: node-postgres will not narrow a
 * NUMERIC(12,2) to a float without losing precision, so it hands back the text.
 * Typing them as `string` is what stops a caller doing arithmetic on them by
 * accident.
 */
export interface SmsPricingTierRow {
  id:            string;
  name:          string;
  min_credits:   number;
  max_credits:   number | null;
  unit_price:    string;
  currency:      string;
  is_active:     boolean;
  display_order: number;
  notes:         string | null;
  created_at:    string;
  updated_at:    string;
}

export interface SmsPackageRow {
  id:             string;
  name:           string;
  description:    string | null;
  credits:        number;
  price:          string;
  currency:       string;
  is_active:      boolean;
  is_recommended: boolean;
  display_order:  number;
  created_at:     string;
  updated_at:     string;
}

/** What `setActiveTiers` reports back: the whole band list either side of the swap. */
export type TierActivationRow = Pick<SmsPricingTierRow, 'id' | 'name' | 'is_active'>;

export interface SmsProviderCostRow {
  id:             string;
  provider:       string;
  unit_cost:      string;
  currency:       string;
  effective_from: string;
  effective_to:   string | null;
  notes:          string | null;
  created_at:     string;
}

export interface TierInput {
  name:         string;
  minCredits:   number;
  maxCredits:   number | null;
  unitPrice:    number;
  displayOrder?: number;
  notes?:       string | null;
}

export interface PackageInput {
  name:          string;
  description?:  string | null;
  credits:       number;
  price:         number;
  isRecommended?: boolean;
  displayOrder?: number;
}

/**
 * Audit every pricing change. group_id is NULL: these are platform-level
 * decisions, not something any one tenant did.
 */
async function audit(
  client: Pick<PoolClient, 'query'>,
  actorId: string,
  action: string,
  resourceId: string | null,
  oldValues: unknown,
  newValues: unknown,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
     VALUES (NULL, $1, $2, 'sms_pricing', $3, $4, $5)`,
    [actorId, action, resourceId,
     oldValues ? JSON.stringify(oldValues) : null,
     newValues ? JSON.stringify(newValues) : null],
  );
}

/** Everything the pricing screen needs, including inactive rows. */
export async function getPricingConfig() {
  return withAdminDb(async (db) => {
    const [tiers, packages, cost] = await Promise.all([
      db.query<SmsPricingTierRow>(`SELECT * FROM sms_pricing_tiers ORDER BY display_order, min_credits`),
      db.query<SmsPackageRow>(`SELECT * FROM sms_packages ORDER BY display_order, credits`),
      db.query<SmsProviderCostRow>(
        `SELECT * FROM sms_provider_costs
         WHERE provider = 'textsms' AND effective_to IS NULL
         ORDER BY effective_from DESC LIMIT 1`,
      ),
    ]);
    return { tiers: tiers.rows, packages: packages.rows, providerCost: cost.rows[0] ?? null };
  });
}

export async function createTier(actorId: string, input: TierInput) {
  if (input.maxCredits !== null && input.maxCredits < input.minCredits) {
    throw new ValidationError('maxCredits must be at least minCredits');
  }
  return withAdminDb(async (db) => {
    // Created INACTIVE always. A new band that priced live traffic the instant
    // it was saved would make a typo a pricing incident; activating is a
    // separate, deliberate call.
    const { rows } = await db.query(
      `INSERT INTO sms_pricing_tiers
         (name, min_credits, max_credits, unit_price, display_order, notes, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,false)
       RETURNING *`,
      [input.name, input.minCredits, input.maxCredits, input.unitPrice.toFixed(4),
       input.displayOrder ?? 0, input.notes ?? null],
    );
    await audit(db, actorId, 'sms_pricing.tier_created', rows[0].id, null, rows[0]);
    return rows[0];
  });
}

export async function updateTier(actorId: string, id: string, input: Partial<TierInput>) {
  return withAdminDb(async (db) => {
    const { rows: before } = await db.query(`SELECT * FROM sms_pricing_tiers WHERE id = $1`, [id]);
    if (!before[0]) throw new NotFoundError('Pricing tier', id);

    const { rows } = await db.query(
      `UPDATE sms_pricing_tiers SET
         name         = COALESCE($2, name),
         min_credits  = COALESCE($3, min_credits),
         max_credits  = CASE WHEN $4::boolean THEN $5 ELSE max_credits END,
         unit_price   = COALESCE($6, unit_price),
         display_order = COALESCE($7, display_order),
         notes        = COALESCE($8, notes),
         updated_at   = NOW()
       WHERE id = $1 RETURNING *`,
      [id, input.name ?? null, input.minCredits ?? null,
       // maxCredits is meaningfully nullable ("and above"), so COALESCE cannot
       // distinguish "leave it" from "set it to unbounded". A flag can.
       Object.prototype.hasOwnProperty.call(input, 'maxCredits'), input.maxCredits ?? null,
       input.unitPrice?.toFixed(4) ?? null, input.displayOrder ?? null, input.notes ?? null],
    );
    await audit(db, actorId, 'sms_pricing.tier_updated', id, before[0], rows[0]);
    return rows[0];
  });
}

/**
 * Switch the live price list in one transaction.
 *
 * THIS IS WHY sms_tier_no_overlap IS DEFERRABLE (migration 143). Exclusion
 * constraints are checked per ROW, so deactivating the old band and activating
 * the new ones transiently has both sets active and would fail mid-statement
 * even though the end state is valid. Deferring moves the check to COMMIT, so
 * what gets validated is the result rather than the journey.
 *
 * Takes the complete set of tier ids that should be live, not a single id:
 * "which bands are active" is one decision, and applying it as a series of
 * independent toggles is what creates invalid intermediate states.
 */
export async function setActiveTiers(actorId: string, tierIds: string[]) {
  // NO manual BEGIN/COMMIT here: withAdminDb already runs its callback inside
  // a transaction. Issuing our own COMMIT ended ITS transaction early and left
  // the pooled client in a mismatched state, which showed up as a deadlock the
  // next time that client was used. The deferred constraint is checked at
  // withAdminDb's COMMIT, which is exactly the boundary we want.
  return withAdminDb(async (db) => {
    await db.query('SET CONSTRAINTS sms_tier_no_overlap DEFERRED');

    const { rows: before } = await db.query<TierActivationRow>(
      `SELECT id, name, is_active FROM sms_pricing_tiers ORDER BY display_order`,
    );

    await db.query(`UPDATE sms_pricing_tiers SET is_active = false, updated_at = NOW() WHERE is_active`);
    if (tierIds.length) {
      await db.query(
        `UPDATE sms_pricing_tiers SET is_active = true, updated_at = NOW() WHERE id = ANY($1::uuid[])`,
        [tierIds],
      );
    }

    const { rows: after } = await db.query<TierActivationRow>(
      `SELECT id, name, is_active FROM sms_pricing_tiers ORDER BY display_order`,
    );
    await audit(db, actorId, 'sms_pricing.tiers_activated', null, before, after);

    // The overlap check runs when withAdminDb commits. An overlapping request
    // therefore throws and changes nothing — the price list cannot be left
    // half-switched.
    return after;
  });
}

export async function createPackage(actorId: string, input: PackageInput) {
  return withAdminDb(async (db) => {
    const { rows } = await db.query(
      `INSERT INTO sms_packages
         (name, description, credits, price, is_recommended, display_order, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,false)
       RETURNING *`,
      [input.name, input.description ?? null, input.credits, input.price.toFixed(2),
       input.isRecommended ?? false, input.displayOrder ?? 0],
    );
    await audit(db, actorId, 'sms_pricing.package_created', rows[0].id, null, rows[0]);
    return rows[0];
  });
}

export async function updatePackage(actorId: string, id: string, input: Partial<PackageInput> & { isActive?: boolean }) {
  return withAdminDb(async (db) => {
    const { rows: before } = await db.query(`SELECT * FROM sms_packages WHERE id = $1`, [id]);
    if (!before[0]) throw new NotFoundError('SMS package', id);

    // Only one active package may be recommended (partial unique index), and
    // the same per-row checking applies — clear the old one first rather than
    // relying on a single statement to sequence itself.
    if (input.isRecommended) {
      await db.query(
        `UPDATE sms_packages SET is_recommended = false, updated_at = NOW()
         WHERE is_recommended AND id <> $1`, [id],
      );
    }

    const { rows } = await db.query(
      `UPDATE sms_packages SET
         name           = COALESCE($2, name),
         description    = COALESCE($3, description),
         credits        = COALESCE($4, credits),
         price          = COALESCE($5, price),
         is_recommended = COALESCE($6, is_recommended),
         is_active      = COALESCE($7, is_active),
         display_order  = COALESCE($8, display_order),
         updated_at     = NOW()
       WHERE id = $1 RETURNING *`,
      [id, input.name ?? null, input.description ?? null, input.credits ?? null,
       input.price?.toFixed(2) ?? null, input.isRecommended ?? null,
       input.isActive ?? null, input.displayOrder ?? null],
    );
    await audit(db, actorId, 'sms_pricing.package_updated', id, before[0], rows[0]);
    return rows[0];
  });
}

/**
 * Record a new provider cost from today, closing the previous window.
 *
 * Never updates the existing row in place: margin on a past sale is computed
 * against the cost that applied THEN (sms-margin.service.ts), so overwriting
 * would silently restate history. The old row is closed, not replaced.
 */
export async function setProviderCost(actorId: string, unitCost: number, notes?: string) {
  if (unitCost < 0) throw new ValidationError('Provider cost cannot be negative');
  // Again no manual transaction — withAdminDb provides one, and closing the old
  // window plus opening the new one must land together or not at all.
  return withAdminDb(async (db) => {
    const { rows: before } = await db.query<SmsProviderCostRow>(
      `SELECT * FROM sms_provider_costs
       WHERE provider = 'textsms' AND effective_to IS NULL`,
    );
    // Close yesterday so the windows do not overlap on the changeover day.
    await db.query(
      `UPDATE sms_provider_costs SET effective_to = CURRENT_DATE - 1
       WHERE provider = 'textsms' AND effective_to IS NULL`,
    );
    const { rows } = await db.query<SmsProviderCostRow>(
      `INSERT INTO sms_provider_costs (provider, unit_cost, effective_from, notes)
       VALUES ('textsms', $1, CURRENT_DATE, $2) RETURNING *`,
      [unitCost.toFixed(4), notes ?? null],
    );
    await audit(db, actorId, 'sms_pricing.provider_cost_changed', rows[0].id, before[0] ?? null, rows[0]);
    return rows[0];
  });
}

export const smsPricingAdminService = {
  getPricingConfig,
  createTier,
  updateTier,
  setActiveTiers,
  createPackage,
  updatePackage,
  setProviderCost,
};
