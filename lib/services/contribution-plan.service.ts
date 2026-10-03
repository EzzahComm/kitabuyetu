/**
 * ContributionPlan - a Configuration Service domain (same pattern as
 * SavingsPolicy/FinePolicy/LoanPolicy: a typed wrapper over
 * configuration.service.ts's generic resolvePolicy/setPolicy).
 *
 * Unlike SavingsPolicy's min/max (advisory guidance only), these two amounts
 * are load-bearing: notify_contribution_reminders (lib/jobs/handlers.ts)
 * reads them to compute each member's outstanding contribution/welfare
 * balance and arrears for the monthly SMS statement. 0 means "this group
 * doesn't track that obligation" - not "no limit" - and a group with both at
 * 0 is simply excluded from the arrears scan.
 */
import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { resolvePolicyDetailed, setPolicy, type PolicySource } from './configuration.service';
import { ValidationError } from '@/lib/utils/errors';

const DOMAIN = 'contribution_plan';
const POLICY_KEY = 'amounts';

export interface ContributionPlanAmounts {
  monthlyContribution: number;
  welfareAmount: number;
}

const DEFAULT_PLAN: ContributionPlanAmounts = {
  monthlyContribution: 0,
  welfareAmount: 0,
};

export interface EffectiveContributionPlan {
  plan: ContributionPlanAmounts;
  source: PolicySource;
}

function validatePlan(plan: ContributionPlanAmounts): void {
  if (!(plan.monthlyContribution >= 0)) {
    throw new ValidationError('monthlyContribution must be zero or positive');
  }
  if (!(plan.welfareAmount >= 0)) {
    throw new ValidationError('welfareAmount must be zero or positive');
  }
}

export const contributionPlanService = {
  async getGroupPlan(ctx: TenantContext): Promise<EffectiveContributionPlan> {
    return withDb(ctx, async (client) => {
      const resolved = await resolvePolicyDetailed<ContributionPlanAmounts>(
        client,
        DOMAIN,
        POLICY_KEY,
        { groupId: ctx.groupId },
        DEFAULT_PLAN,
      );
      return { plan: resolved.value, source: resolved.source };
    });
  },

  /** Access gated at the route (withPermission(req, 'treasury.manage', ...)). */
  async setGroupPlanOverride(ctx: TenantContext, plan: ContributionPlanAmounts): Promise<void> {
    validatePlan(plan);
    await withTransaction(ctx, async (client) => {
      await setPolicy(client, DOMAIN, POLICY_KEY, { groupId: ctx.groupId }, plan, ctx.userId);
    });
  },
};
