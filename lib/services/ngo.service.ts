import { withDb, type TenantContext } from '@/lib/db';
import { ForbiddenError, NotFoundError } from '@/lib/utils/errors';
import type { NgoGroupSummary } from '@/types/api.types';

export const ngoService = {

  async assertNgoCoordinator(ctx: TenantContext): Promise<void> {
    if (ctx.role !== 'ngo_coordinator' && ctx.role !== 'super_admin') {
      throw new ForbiddenError('Only NGO coordinators can access this resource');
    }
    if (ctx.role === 'ngo_coordinator' && !ctx.ngoId) {
      throw new ForbiddenError('NGO context is required');
    }
  },

  async listGroupSummaries(ctx: TenantContext): Promise<NgoGroupSummary[]> {
    await this.assertNgoCoordinator(ctx);

    return withDb(ctx, async (client) => {
      const { rows } = await client.query<NgoGroupSummary>(
        `SELECT
           g.id                                                      AS "groupId",
           g.name                                                    AS "groupName",
           g.type                                                    AS "groupType",
           g.county,
           COUNT(DISTINCT gm.member_id) FILTER (WHERE gm.is_active) AS "activeMemberCount",
           COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'completed'), 0)::text AS "totalContributions",
           COALESCE(SUM(l.outstanding_balance) FILTER (WHERE l.status IN ('disbursed','active')), 0)::text AS "activeLoanPortfolio",
           COUNT(l.id) FILTER (WHERE l.status = 'defaulted')::int   AS "defaultedLoanCount",
           sub.plan_type                                             AS "subscriptionPlan",
           sub.status                                               AS "subscriptionStatus",
           g.created_at::text                                       AS "groupCreatedAt"
         FROM groups g
         JOIN ngo_group_access nga
           ON nga.group_id = g.id
           AND nga.ngo_id  = $1
           AND nga.is_active = true
         LEFT JOIN group_members gm ON gm.group_id = g.id
         LEFT JOIN contributions c  ON c.group_id  = g.id
         LEFT JOIN loans l          ON l.group_id  = g.id
         LEFT JOIN subscriptions sub
           ON sub.group_id = g.id AND sub.status = 'active'
         WHERE g.is_active = true
         GROUP BY g.id, g.name, g.type, g.county, sub.plan_type, sub.status, g.created_at
         ORDER BY g.name`,
        [ctx.ngoId ?? ctx.groupId],
      );
      return rows;
    });
  },

  async getGroupDetail(ctx: TenantContext, groupId: string): Promise<NgoGroupSummary & { monthlyTrend: unknown[] }> {
    await this.assertNgoCoordinator(ctx);

    return withDb(ctx, async (client) => {
      // Verify NGO has access to this specific group
      const { rows: access } = await client.query<{ id: string }>(
        `SELECT id FROM ngo_group_access
         WHERE ngo_id = $1 AND group_id = $2 AND is_active = true`,
        [ctx.ngoId, groupId],
      );
      if (!access[0]) throw new NotFoundError('Group access', groupId);

      const { rows: summary } = await client.query<NgoGroupSummary>(
        `SELECT
           g.id          AS "groupId",
           g.name        AS "groupName",
           g.type        AS "groupType",
           g.county,
           COUNT(DISTINCT gm.member_id) FILTER (WHERE gm.is_active)::int AS "activeMemberCount",
           COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'completed'), 0)::text AS "totalContributions",
           COALESCE(SUM(l.outstanding_balance) FILTER (WHERE l.status IN ('disbursed','active')), 0)::text AS "activeLoanPortfolio",
           COUNT(l.id) FILTER (WHERE l.status = 'defaulted')::int AS "defaultedLoanCount",
           sub.plan_type  AS "subscriptionPlan",
           sub.status     AS "subscriptionStatus",
           g.created_at::text AS "groupCreatedAt"
         FROM groups g
         LEFT JOIN group_members gm ON gm.group_id = g.id
         LEFT JOIN contributions c  ON c.group_id  = g.id
         LEFT JOIN loans l          ON l.group_id  = g.id
         LEFT JOIN subscriptions sub ON sub.group_id = g.id AND sub.status = 'active'
         WHERE g.id = $1
         GROUP BY g.id, g.name, g.type, g.county, sub.plan_type, sub.status, g.created_at`,
        [groupId],
      );
      if (!summary[0]) throw new NotFoundError('Group', groupId);

      // Monthly contribution trend (last 12 months, anonymized)
      const { rows: trend } = await client.query(
        `SELECT
           DATE_TRUNC('month', contribution_date)::date::text AS month,
           COUNT(*)::int                                      AS count,
           SUM(amount)::text                                  AS total
         FROM contributions
         WHERE group_id = $1
           AND status = 'completed'
           AND contribution_date >= NOW() - INTERVAL '12 months'
         GROUP BY DATE_TRUNC('month', contribution_date)
         ORDER BY month`,
        [groupId],
      );

      return { ...summary[0], monthlyTrend: trend };
    });
  },
};
