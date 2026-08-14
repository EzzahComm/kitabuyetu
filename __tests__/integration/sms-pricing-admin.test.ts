/**
 * Super-admin SMS pricing controls (spec §12) against real Postgres.
 *
 * The load-bearing test here is the atomic price-list switch. Everything else
 * is CRUD; that one is the reason sms_tier_no_overlap was made DEFERRABLE in
 * migration 143, and it is the operation most likely to leave the product in a
 * state where nothing can be priced.
 */
import { smsPricingAdminService } from '@/lib/services/sms-pricing-admin.service';
import { getUnitPrice } from '@/lib/services/sms-pricing.service';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';

/** Back to exactly what migration 143 seeds — these are config tables, which resetDatabase leaves alone. */
async function restoreSeededPricing(): Promise<void> {
  await rawQuery(`DELETE FROM sms_pricing_tiers WHERE name NOT IN
    ('Standard','Volume 1–5k','Volume 5k–10k','Volume 10k–50k','Volume 50k–100k','Volume 100k+')`);
  await rawQuery(`DELETE FROM sms_packages WHERE name NOT IN
    ('Starter','Growth','Professional','Enterprise','Enterprise+')`);
  await rawQuery(`UPDATE sms_pricing_tiers SET is_active = false WHERE is_active`);
  await rawQuery(`UPDATE sms_pricing_tiers SET is_active = true WHERE name = 'Standard'`);
  await rawQuery(`UPDATE sms_packages SET is_active = false, is_recommended = false`);
  await rawQuery(`DELETE FROM sms_provider_costs WHERE unit_cost <> 0.3500`);
  await rawQuery(
    `UPDATE sms_provider_costs
     SET effective_from = CURRENT_DATE - 365, effective_to = NULL, unit_cost = 0.3500
     WHERE provider = 'textsms'`,
  );
}

async function tierIdsNamed(names: string[]): Promise<string[]> {
  const rows = await rawQuery<{ id: string }>(
    `SELECT id FROM sms_pricing_tiers WHERE name = ANY($1::text[]) ORDER BY display_order`, [names],
  );
  return rows.map((r) => r.id);
}

async function auditCount(action: string): Promise<number> {
  const [row] = await rawQuery<{ count: string }>(
    `SELECT count(*)::text AS count FROM audit_logs WHERE action = $1`, [action],
  );
  return Number(row.count);
}

describe('super-admin SMS pricing controls (§12)', () => {
  let actorId: string;

  beforeEach(async () => {
    await resetDatabase();
    ({ officerId: actorId } = await createTestGroup('chairperson'));
    await restoreSeededPricing();
  });

  afterAll(restoreSeededPricing);

  describe('the atomic price-list switch', () => {
    it('swaps the flat band for the five volume bands in one transaction', async () => {
      // THE OPERATION migration 143's DEFERRABLE constraint exists for.
      // Exclusion constraints are checked per ROW, so deactivating one band
      // while activating five transiently has all six live and would fail
      // mid-statement even though the end state is perfectly valid.
      expect(await getUnitPrice(20_000)).toBe(0.9); // flat band today

      const volumeIds = await tierIdsNamed([
        'Volume 1–5k', 'Volume 5k–10k', 'Volume 10k–50k', 'Volume 50k–100k', 'Volume 100k+',
      ]);
      await smsPricingAdminService.setActiveTiers(actorId, volumeIds);

      expect(await getUnitPrice(20_000)).toBe(0.7);  // now volume-priced
      expect(await getUnitPrice(200_000)).toBe(0.5);
    });

    it('leaves the live price list untouched when the requested set overlaps', async () => {
      // A half-applied switch is the worst outcome: some volumes priced, others
      // not. Deferring to COMMIT means an invalid request changes nothing.
      const overlapping = await tierIdsNamed(['Standard', 'Volume 1–5k']); // both cover 0-5000

      await expect(
        smsPricingAdminService.setActiveTiers(actorId, overlapping),
      ).rejects.toThrow(/exclusion|overlap/i);

      // Still exactly the seeded flat band, still pricing.
      expect(await getUnitPrice(20_000)).toBe(0.9);
      const active = await rawQuery<{ name: string }>(
        `SELECT name FROM sms_pricing_tiers WHERE is_active`,
      );
      expect(active).toHaveLength(1);
      expect(active[0].name).toBe('Standard');
    });

    it('can switch back', async () => {
      const volumeIds   = await tierIdsNamed(['Volume 1–5k', 'Volume 5k–10k', 'Volume 10k–50k', 'Volume 50k–100k', 'Volume 100k+']);
      await smsPricingAdminService.setActiveTiers(actorId, volumeIds);
      const [standard] = await tierIdsNamed(['Standard']);
      await smsPricingAdminService.setActiveTiers(actorId, [standard]);

      expect(await getUnitPrice(200_000)).toBe(0.9);
    });
  });

  describe('creating and editing', () => {
    it('creates a tier INACTIVE, so a typo cannot become a pricing incident', async () => {
      const tier = await smsPricingAdminService.createTier(actorId, {
        name: 'Trial band', minCredits: 0, maxCredits: 10, unitPrice: 0.01,
      });
      expect(tier.is_active).toBe(false);
      // The live price is unchanged by a creation.
      expect(await getUnitPrice(5)).toBe(0.9);
    });

    it('rejects an inverted band', async () => {
      await expect(
        smsPricingAdminService.createTier(actorId, {
          name: 'Backwards', minCredits: 100, maxCredits: 10, unitPrice: 0.5,
        }),
      ).rejects.toThrow(/maxCredits/i);
    });

    it('can set a tier back to open-ended, which COALESCE alone cannot express', async () => {
      const tier = await smsPricingAdminService.createTier(actorId, {
        name: 'Capped', minCredits: 0, maxCredits: 500, unitPrice: 0.5,
      });
      const updated = await smsPricingAdminService.updateTier(actorId, tier.id, { maxCredits: null });
      // null is a real value here ("and above"), not an absent one — which is
      // why the update uses an explicit has-property flag rather than COALESCE.
      expect(updated.max_credits).toBeNull();
    });

    it('keeps at most one recommended package', async () => {
      const rows = await rawQuery<{ id: string; name: string }>(
        `SELECT id, name FROM sms_packages ORDER BY display_order LIMIT 2`,
      );
      await smsPricingAdminService.updatePackage(actorId, rows[0].id, { isActive: true, isRecommended: true });
      await smsPricingAdminService.updatePackage(actorId, rows[1].id, { isActive: true, isRecommended: true });

      const recommended = await rawQuery(
        `SELECT id FROM sms_packages WHERE is_recommended AND is_active`,
      );
      expect(recommended).toHaveLength(1);
    });
  });

  describe('provider cost', () => {
    it('closes the old window instead of overwriting it, so history holds', async () => {
      // Margin on a past sale is computed against the cost that applied then.
      // Overwriting the row would silently restate every prior month.
      await smsPricingAdminService.setProviderCost(actorId, 0.42, 'provider raised rates');

      const rows = await rawQuery<{ unit_cost: string; effective_to: string | null }>(
        `SELECT unit_cost, effective_to FROM sms_provider_costs
         WHERE provider = 'textsms' ORDER BY effective_from`,
      );
      expect(rows).toHaveLength(2);
      expect(rows[0].effective_to).not.toBeNull();   // old one closed
      expect(Number(rows[1].unit_cost)).toBe(0.42);  // new one open
      expect(rows[1].effective_to).toBeNull();
    });

    it('refuses a negative cost', async () => {
      await expect(smsPricingAdminService.setProviderCost(actorId, -1)).rejects.toThrow(/negative/i);
    });
  });

  describe('auditability (§12)', () => {
    it('records who changed what, for every kind of change', async () => {
      // "All changes should be auditable" — a price change with no record of
      // who made it is the one you most want to be able to trace.
      const before = await auditCount('sms_pricing.tier_created');

      const tier = await smsPricingAdminService.createTier(actorId, {
        name: 'Audited', minCredits: 0, maxCredits: 1, unitPrice: 0.11,
      });
      await smsPricingAdminService.updateTier(actorId, tier.id, { unitPrice: 0.22 });
      await smsPricingAdminService.setProviderCost(actorId, 0.4);

      expect(await auditCount('sms_pricing.tier_created')).toBe(before + 1);
      expect(await auditCount('sms_pricing.tier_updated')).toBeGreaterThan(0);
      expect(await auditCount('sms_pricing.provider_cost_changed')).toBeGreaterThan(0);

      const [row] = await rawQuery<{ actor_id: string; old_values: unknown; new_values: unknown; group_id: string | null }>(
        `SELECT actor_id, old_values, new_values, group_id FROM audit_logs
         WHERE action = 'sms_pricing.tier_updated' ORDER BY created_at DESC LIMIT 1`,
      );
      expect(row.actor_id).toBe(actorId);
      // Both sides recorded, so a change can be read as a change.
      expect(row.old_values).toBeTruthy();
      expect(row.new_values).toBeTruthy();
      // Platform-level decision, not something a tenant did.
      expect(row.group_id).toBeNull();
    });
  });
});
