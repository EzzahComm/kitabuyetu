/**
 * Runtime feature-flag evaluation (audit §33.4) — the targeting semantics
 * (enabled / applies_to / conditions / rollout_pct) that migration 025
 * declared but nothing had ever evaluated.
 */
import { isFeatureEnabled } from '@/lib/services/feature-flags.service';

const mockQuery  = jest.fn();
const mockClient = { query: mockQuery } as never;

beforeEach(() => mockQuery.mockReset());

function flagRow(overrides: Record<string, unknown> = {}) {
  return {
    rows: [{
      enabled: true, rollout_pct: 100, applies_to: 'all', conditions: {},
      ...overrides,
    }],
  };
}

describe('isFeatureEnabled', () => {
  it('fails open for a key with no row (gating shipped modules can never brick them)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(isFeatureEnabled(mockClient, 'nonexistent', { groupId: 'g1' })).resolves.toBe(true);
  });

  it('is off for everyone when enabled=false, regardless of targeting', async () => {
    mockQuery.mockResolvedValueOnce(flagRow({ enabled: false }));
    await expect(isFeatureEnabled(mockClient, 'welfare_module', { groupId: 'g1' })).resolves.toBe(false);
  });

  it("applies_to='all' with full rollout is on", async () => {
    mockQuery.mockResolvedValueOnce(flagRow());
    await expect(isFeatureEnabled(mockClient, 'welfare_module', { groupId: 'g1' })).resolves.toBe(true);
  });

  describe("applies_to='plan'", () => {
    it('is on when the group plan meets min_plan', async () => {
      mockQuery
        .mockResolvedValueOnce(flagRow({ applies_to: 'plan', conditions: { min_plan: 'growth' } }))
        .mockResolvedValueOnce({ rows: [{ plan_type: 'enterprise' }] });
      await expect(isFeatureEnabled(mockClient, 'bulk_sms', { groupId: 'g1' })).resolves.toBe(true);
    });

    it('is off when the group plan is below min_plan', async () => {
      mockQuery
        .mockResolvedValueOnce(flagRow({ applies_to: 'plan', conditions: { min_plan: 'growth' } }))
        .mockResolvedValueOnce({ rows: [{ plan_type: 'starter' }] });
      await expect(isFeatureEnabled(mockClient, 'bulk_sms', { groupId: 'g1' })).resolves.toBe(false);
    });

    it('is off when the group has no active subscription', async () => {
      mockQuery
        .mockResolvedValueOnce(flagRow({ applies_to: 'plan', conditions: { min_plan: 'growth' } }))
        .mockResolvedValueOnce({ rows: [] });
      await expect(isFeatureEnabled(mockClient, 'bulk_sms', { groupId: 'g1' })).resolves.toBe(false);
    });

    it('is off when min_plan names an unknown plan', async () => {
      mockQuery.mockResolvedValueOnce(flagRow({ applies_to: 'plan', conditions: { min_plan: 'platinum' } }));
      await expect(isFeatureEnabled(mockClient, 'bulk_sms', { groupId: 'g1' })).resolves.toBe(false);
    });
  });

  describe("applies_to='group' / 'member'", () => {
    it('is on only for listed groups', async () => {
      mockQuery.mockResolvedValueOnce(flagRow({ applies_to: 'group', conditions: { group_ids: ['g1', 'g2'] } }));
      await expect(isFeatureEnabled(mockClient, 'new_dashboard', { groupId: 'g1' })).resolves.toBe(true);

      mockQuery.mockResolvedValueOnce(flagRow({ applies_to: 'group', conditions: { group_ids: ['g1', 'g2'] } }));
      await expect(isFeatureEnabled(mockClient, 'new_dashboard', { groupId: 'g3' })).resolves.toBe(false);
    });

    it('is off for group targeting with no group_ids at all', async () => {
      mockQuery.mockResolvedValueOnce(flagRow({ applies_to: 'group', conditions: {} }));
      await expect(isFeatureEnabled(mockClient, 'new_dashboard', { groupId: 'g1' })).resolves.toBe(false);
    });

    it('is on only for listed members', async () => {
      mockQuery.mockResolvedValueOnce(flagRow({ applies_to: 'member', conditions: { member_ids: ['m1'] } }));
      await expect(isFeatureEnabled(mockClient, 'beta_thing', { memberId: 'm1' })).resolves.toBe(true);

      mockQuery.mockResolvedValueOnce(flagRow({ applies_to: 'member', conditions: { member_ids: ['m1'] } }));
      await expect(isFeatureEnabled(mockClient, 'beta_thing', { memberId: 'm2' })).resolves.toBe(false);
    });
  });

  describe('rollout_pct', () => {
    it('0% is off even when enabled and targeted', async () => {
      mockQuery.mockResolvedValueOnce(flagRow({ rollout_pct: 0 }));
      await expect(isFeatureEnabled(mockClient, 'welfare_module', { groupId: 'g1' })).resolves.toBe(false);
    });

    it('is deterministic — the same subject always resolves the same way', async () => {
      const results: boolean[] = [];
      for (let i = 0; i < 5; i++) {
        mockQuery.mockResolvedValueOnce(flagRow({ rollout_pct: 50 }));
        results.push(await isFeatureEnabled(mockClient, 'welfare_module', { groupId: 'stable-group-id' }));
      }
      expect(new Set(results).size).toBe(1);
    });

    it('splits a population roughly by the configured percentage', async () => {
      let onCount = 0;
      const n = 200;
      for (let i = 0; i < n; i++) {
        mockQuery.mockResolvedValueOnce(flagRow({ rollout_pct: 50 }));
        if (await isFeatureEnabled(mockClient, 'welfare_module', { groupId: `group-${i}` })) onCount++;
      }
      expect(onCount).toBeGreaterThan(n * 0.35);
      expect(onCount).toBeLessThan(n * 0.65);
    });

    it('needs a stable subject — no group or member means off for partial rollouts', async () => {
      mockQuery.mockResolvedValueOnce(flagRow({ rollout_pct: 50 }));
      await expect(isFeatureEnabled(mockClient, 'welfare_module', {})).resolves.toBe(false);
    });
  });
});
