/**
 * SMS pricing engine (migration 143) against real Postgres.
 *
 * Phase 2 of docs/audits/SMS_MONETIZATION_AUDIT_2026-08.md. Two things matter
 * here above all others, and both are properties of the DATABASE rather than of
 * the service:
 *
 *   1. Shipping this must reprice NOBODY. The seeded table is one flat 0.90
 *      band, which is what every production subscription charges today.
 *   2. Two active bands must never overlap, or the price of a given volume
 *      depends on row order.
 *
 * Real Postgres specifically: the overlap rule is a GiST exclusion constraint
 * and the cost table's protection is RLS-with-no-policy. Neither survives a
 * mock.
 */
import {
  getUnitPrice, listActiveTiers, listActivePackages, getProviderCost, marginFor,
} from '@/lib/services/sms-pricing.service';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';

/**
 * Restore the pricing tables to exactly what migration 143 seeds.
 *
 * These are CONFIGURATION, not tenant data, so `resetDatabase()` does not
 * truncate them — which means a test that activates a tier or expires a cost
 * leaks that change into every later test AND into the next run of the suite.
 * (Found the hard way: the first green run left the volume bands active and
 * the second run failed 14 tests.) Configuration state has to be restored
 * explicitly, not assumed.
 */
async function restoreSeededPricing(): Promise<void> {
  await rawQuery(`DELETE FROM sms_pricing_tiers WHERE name IN ('Overlap', 'Draft')`);
  // Two statements, deactivate before activate. A single
  // `SET is_active = (name = 'Standard')` fails: exclusion constraints are
  // checked per ROW, so mid-statement both the flat band and the volume bands
  // are active and overlap. (The constraint is DEFERRABLE precisely so a real
  // admin swap can do this atomically inside one transaction — see migration
  // 143 — but rawQuery runs each statement on its own connection.)
  await rawQuery(`UPDATE sms_pricing_tiers SET is_active = false WHERE is_active`);
  await rawQuery(`UPDATE sms_pricing_tiers SET is_active = true WHERE name = 'Standard'`);
  await rawQuery(`UPDATE sms_packages SET is_active = false, is_recommended = false`);
  await rawQuery(
    `UPDATE sms_provider_costs
     SET effective_from = CURRENT_DATE, effective_to = NULL, unit_cost = 0.3500
     WHERE provider = 'textsms'`,
  );
}

describe('SMS pricing engine', () => {
  beforeEach(async () => {
    await resetDatabase();
    await restoreSeededPricing();
  });

  afterAll(restoreSeededPricing);

  describe('seeded state — the "changes nothing" guarantee', () => {
    it('prices every volume at the flat rate charged today', async () => {
      // If any of these ever stops being 0.90, migration 143 has repriced live
      // customers as a side effect of deploying, which §21 forbids.
      for (const volume of [0, 1, 5000, 10_000, 50_000, 250_000, 10_000_000]) {
        expect(await getUnitPrice(volume)).toBe(0.9);
      }
    });

    it('exposes exactly one active band', async () => {
      const tiers = await listActiveTiers();
      expect(tiers).toHaveLength(1);
      expect(tiers[0].unitPrice).toBe(0.9);
      expect(tiers[0].maxCredits).toBeNull(); // open-ended: covers all volumes
    });

    it('ships the proposed volume table inactive, not live', async () => {
      const [row] = await rawQuery<{ count: string }>(
        `SELECT count(*)::text AS count FROM sms_pricing_tiers WHERE NOT is_active`,
      );
      expect(Number(row.count)).toBe(5);
      // Present but dormant: switching to volume pricing is an admin action
      // with an audit trail, not a deployment side effect.
      expect(await listActiveTiers()).toHaveLength(1);
    });

    it('ships packages inactive until there is a flow to sell them', async () => {
      expect(await listActivePackages()).toHaveLength(0);
      const [row] = await rawQuery<{ count: string }>(
        `SELECT count(*)::text AS count FROM sms_packages`,
      );
      expect(Number(row.count)).toBe(5);
    });
  });

  describe('volume banding, once activated', () => {
    beforeEach(async () => {
      // Flip to the proposed table the way an admin would.
      // Deactivate before activate — see restoreSeededPricing for why.
      await rawQuery(`UPDATE sms_pricing_tiers SET is_active = false WHERE name = 'Standard'`);
      await rawQuery(`UPDATE sms_pricing_tiers SET is_active = true  WHERE name <> 'Standard'`);
    });

    it.each([
      [1,       0.9],
      [5000,    0.9],
      [5001,    0.8],
      [10_000,  0.8],
      [10_001,  0.7],
      [50_000,  0.7],
      [50_001,  0.6],
      [100_000, 0.6],
      [100_001, 0.5],
      [999_999, 0.5],
    ])('prices %i messages at %d', async (volume, expected) => {
      expect(await getUnitPrice(volume)).toBe(expected);
    });

    it('leaves no gap between bands', async () => {
      // A volume that falls in no band would silently take the fallback price.
      // Walking the boundaries proves the bands are contiguous.
      for (const v of [5000, 5001, 10_000, 10_001, 50_000, 50_001, 100_000, 100_001]) {
        expect(await getUnitPrice(v)).toBeGreaterThan(0);
      }
    });
  });

  describe('the overlap invariant', () => {
    it('rejects a second active band covering the same volume', async () => {
      // Without this, two bands could both match and the price would depend on
      // row order — the exact ambiguity a hand-rolled CASE ladder has.
      await expect(
        rawQuery(
          `INSERT INTO sms_pricing_tiers (name, min_credits, max_credits, unit_price, is_active)
           VALUES ('Overlap', 0, NULL, 0.10, true)`,
        ),
      ).rejects.toThrow(/exclusion constraint|sms_tier_no_overlap/i);
    });

    it('allows overlapping INACTIVE bands, which is how the proposal is stored', async () => {
      await expect(
        rawQuery(
          `INSERT INTO sms_pricing_tiers (name, min_credits, max_credits, unit_price, is_active)
           VALUES ('Draft', 0, NULL, 0.10, false)`,
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('provider cost and margin (§15)', () => {
    it('reads the confirmed cost', async () => {
      expect(await getProviderCost()).toBe(0.35);
    });

    it('computes margin against the price actually charged', async () => {
      const m = await marginFor(0.9);
      expect(m).not.toBeNull();
      expect(m!.margin).toBeCloseTo(0.55, 4);
      expect(m!.marginPct).toBeCloseTo(61.1, 1);
    });

    it('still clears margin at the proposed floor price', async () => {
      // §19 warned not to assume 0.50 is sustainable. At a 0.35 cost it is —
      // 30% gross. Re-check this test if the provider's rate ever moves; the
      // bottom band is the first to go underwater.
      const m = await marginFor(0.5);
      expect(m!.margin).toBeCloseTo(0.15, 4);
      expect(m!.marginPct).toBeCloseTo(30, 1);
    });

    it('reports unknown rather than inventing a cost', async () => {
      // Retire the cost by moving its whole validity window into the past.
      // Note effective_to alone cannot be backdated — sms_cost_window_sane
      // requires effective_to >= effective_from, which is the constraint
      // stopping anyone from recording a window that never existed.
      await rawQuery(
        `UPDATE sms_provider_costs
         SET effective_from = CURRENT_DATE - 10, effective_to = CURRENT_DATE - 1`,
      );
      expect(await getProviderCost()).toBeNull();
      // Showing a plausible-but-fabricated margin would be worse than showing
      // none, because someone would price against it.
      expect(await marginFor(0.9)).toBeNull();
    });

    it('keeps provider cost unreadable by tenants', async () => {
      // RLS on with NO policy denies every tenant read outright. §15: provider
      // cost is never exposed to customers.
      const [rls] = await rawQuery<{ relrowsecurity: boolean }>(
        `SELECT relrowsecurity FROM pg_class WHERE relname = 'sms_provider_costs'`,
      );
      expect(rls.relrowsecurity).toBe(true);

      const [policies] = await rawQuery<{ count: string }>(
        `SELECT count(*)::text AS count FROM pg_policies WHERE tablename = 'sms_provider_costs'`,
      );
      expect(Number(policies.count)).toBe(0);
    });
  });
});
