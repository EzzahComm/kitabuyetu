/**
 * SavingsPolicy — a new Configuration Service domain (ACCOUNTING_ARCHITECTURE_AUDIT.md
 * §29.5/§33.5), following the exact pattern proven by ApprovalPolicy/LoanPolicy:
 * a typed wrapper over configuration.service.ts's generic resolvePolicy/setPolicy.
 *
 * Unlike LoanPolicy/FinePolicy, there was no prior hardcoded constant or retired
 * group_constitutions column for min/max contribution or a grace period — §22
 * found these simply didn't exist as a feature. Confirmed product decision:
 * advisory only. contributions.service.ts's create() is unchanged by this
 * domain; the contribution form reads it only to pre-fill/annotate, exactly
 * like loan terms (migration 088) — a treasurer can still record any positive
 * amount regardless of what this policy says.
 */
import type { PoolClient } from 'pg';
import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { resolvePolicy, resolvePolicyDetailed, setPolicy, type PolicySource } from './configuration.service';
import { ValidationError } from '@/lib/utils/errors';

const DOMAIN = 'savings';
const POLICY_KEY = 'limits';

export interface SavingsLimits {
  minContribution:  number;
  maxContribution:  number | null;
  gracePeriodDays:  number;
}

// Kept identical to migration 092's seed — the defensive floor if a domain
// row is ever missing (should not happen once the migration has run).
const DEFAULT_SAVINGS_LIMITS: SavingsLimits = {
  minContribution: 0, maxContribution: null, gracePeriodDays: 0,
};

export interface EffectiveSavingsLimits {
  limits: SavingsLimits;
  source: PolicySource;
}

/** Used inline by advisory read paths — no route/role concerns, just a read. */
export async function getEffectiveSavingsLimits(
  client: PoolClient,
  scope:  { organizationId?: string | null; groupId?: string | null },
): Promise<SavingsLimits> {
  return resolvePolicy<SavingsLimits>(client, DOMAIN, POLICY_KEY, scope, DEFAULT_SAVINGS_LIMITS);
}

function validateSavingsLimits(limits: SavingsLimits): void {
  if (!(limits.minContribution >= 0)) {
    throw new ValidationError('minContribution must be zero or positive');
  }
  if (limits.maxContribution !== null && !(limits.maxContribution > limits.minContribution)) {
    throw new ValidationError('maxContribution must be greater than minContribution, or null for no maximum');
  }
  if (!(Number.isInteger(limits.gracePeriodDays) && limits.gracePeriodDays >= 0)) {
    throw new ValidationError('gracePeriodDays must be a whole number, zero or positive');
  }
}

export const savingsPolicyService = {
  async getGroupLimits(ctx: TenantContext): Promise<EffectiveSavingsLimits> {
    return withDb(ctx, async (client) => {
      const resolved = await resolvePolicyDetailed<SavingsLimits>(
        client, DOMAIN, POLICY_KEY, { groupId: ctx.groupId }, DEFAULT_SAVINGS_LIMITS,
      );
      return { limits: resolved.value, source: resolved.source };
    });
  },

  /** Access gated at the route (withRole(req, 'treasurer', ...)) — advisory only, changes no enforcement. */
  async setGroupLimitsOverride(ctx: TenantContext, limits: SavingsLimits): Promise<void> {
    validateSavingsLimits(limits);
    await withTransaction(ctx, async (client) => {
      await setPolicy(client, DOMAIN, POLICY_KEY, { groupId: ctx.groupId }, limits, ctx.userId);
    });
  },

  /** Platform-wide default — super_admin only (enforced at the route via withPlatformRole). */
  async getPlatformLimits(client: PoolClient): Promise<EffectiveSavingsLimits> {
    const resolved = await resolvePolicyDetailed<SavingsLimits>(client, DOMAIN, POLICY_KEY, {}, DEFAULT_SAVINGS_LIMITS);
    return { limits: resolved.value, source: resolved.source };
  },

  async setPlatformLimitsDefault(userId: string, client: PoolClient, limits: SavingsLimits): Promise<void> {
    validateSavingsLimits(limits);
    await setPolicy(client, DOMAIN, POLICY_KEY, {}, limits, userId);
  },
};
