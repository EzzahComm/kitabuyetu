/**
 * LoanPolicy — the second Configuration Service domain wired end-to-end
 * (ACCOUNTING_ARCHITECTURE_AUDIT.md §29.5/§33.5), following the exact
 * pattern proven by ApprovalPolicy (§29's first domain): a typed wrapper
 * over configuration.service.ts's generic resolvePolicy/setPolicy.
 *
 * Replaces credit-scores.service.ts's hardcoded TIER_THRESHOLDS constant —
 * the literal example §29.6 uses to illustrate "code-driven vs
 * policy-driven" — with a Platform -> Organization -> Group configurable
 * reliability-tier ladder. loan_eligibility_limit (the value this ladder
 * drives) is purely advisory today — no loan-approval code path reads it —
 * so making it configurable changes zero lending-enforcement behavior.
 */
import type { PoolClient } from 'pg';
import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { resolvePolicy, resolvePolicyDetailed, setPolicy, type PolicySource } from './configuration.service';
import { ValidationError } from '@/lib/utils/errors';

const DOMAIN = 'loan';
const POLICY_KEY = 'tier_thresholds';

export type ReliabilityTier = 'excellent' | 'good' | 'fair' | 'poor' | 'high_risk';

export interface TierThreshold {
  tier:           ReliabilityTier;
  min:            number;
  loanMultiplier: number;
}

// Kept identical to migration 087's seed — the defensive floor if a domain
// row is ever missing (should not happen once the migration has run).
const DEFAULT_TIER_THRESHOLDS: TierThreshold[] = [
  { tier: 'excellent', min: 85, loanMultiplier: 10   },
  { tier: 'good',      min: 70, loanMultiplier: 5    },
  { tier: 'fair',      min: 55, loanMultiplier: 3    },
  { tier: 'poor',      min: 40, loanMultiplier: 1    },
  { tier: 'high_risk', min: 0,  loanMultiplier: 0.5  },
];

export interface EffectiveTierThresholds {
  thresholds: TierThreshold[];
  source:     PolicySource;
}

/** Used inline by credit-scores.service.ts — no route/role concerns, just a read. */
export async function getEffectiveTierThresholds(
  client: PoolClient,
  scope:  { organizationId?: string | null; groupId?: string | null },
): Promise<TierThreshold[]> {
  return resolvePolicy<TierThreshold[]>(client, DOMAIN, POLICY_KEY, scope, DEFAULT_TIER_THRESHOLDS);
}

function validateThresholds(thresholds: TierThreshold[]): void {
  const requiredTiers: ReliabilityTier[] = ['excellent', 'good', 'fair', 'poor', 'high_risk'];
  if (thresholds.length !== requiredTiers.length
      || !requiredTiers.every((t) => thresholds.some((th) => th.tier === t))) {
    throw new ValidationError(`Must supply exactly one threshold for each tier: ${requiredTiers.join(', ')}`);
  }
  for (const t of thresholds) {
    if (!(t.min >= 0 && t.min <= 100)) throw new ValidationError(`${t.tier}: min must be between 0 and 100`);
    if (!(t.loanMultiplier >= 0)) throw new ValidationError(`${t.tier}: loanMultiplier must be zero or positive`);
  }
  // Each tier's min must be strictly greater than the next-lowest tier's —
  // checked against requiredTiers' fixed rank order, not just the sorted
  // min values, so a shuffled assignment (e.g. 'fair' outranking
  // 'excellent') is caught even though the raw numbers still sort cleanly.
  const byTier = new Map(thresholds.map((t) => [t.tier, t]));
  for (let i = 1; i < requiredTiers.length; i++) {
    const higher = byTier.get(requiredTiers[i - 1])!;
    const lower  = byTier.get(requiredTiers[i])!;
    if (lower.min >= higher.min) {
      throw new ValidationError(
        `${requiredTiers[i - 1]}'s min (${higher.min}) must be strictly greater than ${requiredTiers[i]}'s min (${lower.min})`,
      );
    }
  }
  if (byTier.get('high_risk')!.min !== 0) {
    throw new ValidationError('high_risk must have min = 0 so every score resolves to a tier');
  }
}

export const loanPolicyService = {
  async getGroupPolicy(ctx: TenantContext): Promise<EffectiveTierThresholds> {
    return withDb(ctx, async (client) => {
      const resolved = await resolvePolicyDetailed<TierThreshold[]>(
        client, DOMAIN, POLICY_KEY, { groupId: ctx.groupId }, DEFAULT_TIER_THRESHOLDS,
      );
      return { thresholds: resolved.value, source: resolved.source };
    });
  },

  /** Access gated at the route (withRole(req, 'chairperson', ...)) — changes scoring for the whole group. */
  async setGroupOverride(ctx: TenantContext, thresholds: TierThreshold[]): Promise<void> {
    validateThresholds(thresholds);
    await withTransaction(ctx, async (client) => {
      await setPolicy(client, DOMAIN, POLICY_KEY, { groupId: ctx.groupId }, thresholds, ctx.userId);
    });
  },

  /** Platform-wide default — super_admin only (enforced at the route via withPlatformRole). */
  async getPlatformPolicy(client: PoolClient): Promise<EffectiveTierThresholds> {
    const resolved = await resolvePolicyDetailed<TierThreshold[]>(client, DOMAIN, POLICY_KEY, {}, DEFAULT_TIER_THRESHOLDS);
    return { thresholds: resolved.value, source: resolved.source };
  },

  async setPlatformDefault(userId: string, client: PoolClient, thresholds: TierThreshold[]): Promise<void> {
    validateThresholds(thresholds);
    await setPolicy(client, DOMAIN, POLICY_KEY, {}, thresholds, userId);
  },
};
