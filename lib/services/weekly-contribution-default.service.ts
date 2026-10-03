/**
 * Default weekly contribution target (migration 207) — a platform-wide
 * baseline (KES 200/week) every group is measured against in the weekly
 * savings-update reminder, even if it never configured its own
 * contribution_plan. Deliberately a SEPARATE domain from contribution_plan
 * (see that service's own header) — this one exists purely to give the
 * weekly reminder something to compute "outstanding" against for groups
 * that have never set anything themselves.
 *
 * Resolved through the generic Configuration Service cascade: a group's own
 * override (if it ever sets one) wins over this platform-wide default.
 */
import { withAdminDb, withDb, type TenantContext } from '@/lib/db';
import { resolvePolicy, setPolicy } from './configuration.service';
import { ValidationError } from '@/lib/utils/errors';

const DOMAIN = 'weekly_contribution_default';
const POLICY_KEY = 'amount';

export interface WeeklyContributionDefault {
  weeklyContribution: number;
}

const FALLBACK: WeeklyContributionDefault = { weeklyContribution: 0 };

export const weeklyContributionDefaultService = {
  /** The effective weekly target for a specific group (its own override, if any, else the platform default). */
  async getForGroup(ctx: TenantContext): Promise<number> {
    return withDb(ctx, async (client) => {
      const value = await resolvePolicy<WeeklyContributionDefault>(client, DOMAIN, POLICY_KEY, {}, FALLBACK);
      return value.weeklyContribution;
    });
  },

  /** The platform-wide default, as platform admins see/manage it. */
  async getPlatformDefault(): Promise<number> {
    return withAdminDb(async (client) => {
      const value = await resolvePolicy<WeeklyContributionDefault>(client, DOMAIN, POLICY_KEY, {}, FALLBACK);
      return value.weeklyContribution;
    });
  },

  /** Platform admin changes the platform-wide default for every group without its own override. */
  async setPlatformDefault(adminUserId: string, weeklyContribution: number): Promise<void> {
    if (!(weeklyContribution >= 0)) {
      throw new ValidationError('weeklyContribution must be zero or positive');
    }
    await withAdminDb(async (client) => {
      await setPolicy(client, DOMAIN, POLICY_KEY, {}, { weeklyContribution }, adminUserId);
    });
  },
};
