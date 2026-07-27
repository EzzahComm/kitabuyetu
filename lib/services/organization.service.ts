import { withDb, type TenantContext } from '@/lib/db';
import { ForbiddenError, NotFoundError } from '@/lib/utils/errors';
import type { OrganizationGroupSummary, OrganizationProfile } from '@/types/api.types';
import type { PaginatedResult } from '@/types/db.types';

export const organizationService = {

  async assertOrganizationCoordinator(ctx: TenantContext): Promise<void> {
    if (ctx.role !== 'organization_coordinator' && ctx.role !== 'super_admin') {
      throw new ForbiddenError('Only Organization coordinators can access this resource');
    }
    if (ctx.role === 'organization_coordinator' && !ctx.organizationId) {
      throw new ForbiddenError('Organization context is required');
    }
  },

  /** The coordinator's own organization — name/type for portal chrome (e.g. the enterprise sidebar). */
  async getProfile(ctx: TenantContext): Promise<OrganizationProfile> {
    await this.assertOrganizationCoordinator(ctx);
    return withDb(ctx, async (client) => {
      const { rows } = await client.query<OrganizationProfile>(
        `SELECT id, name, type FROM organizations WHERE id = $1`,
        [ctx.organizationId],
      );
      if (!rows[0]) throw new NotFoundError('Organization', ctx.organizationId ?? '');
      return rows[0];
    });
  },

  /**
   * Bounded, not truly paginated in the UI sense — every consumer (Funding
   * Portal's linked-groups grid + disbursement group-picker, the enterprise
   * portfolio's top-N sort, the branches search/filter list) wants "every
   * group this org can see" for client-side search/sort, not a pager.
   * `limit` defaults to a generous cap (mirrors the `/members?limit=200`
   * convention used elsewhere) so a federation with an unusually large group
   * count can't turn this into a truly unbounded query
   * (audit/04-performance-findings.md #1).
   */
  async listGroupSummaries(
    ctx: TenantContext,
    params: { page?: number; limit?: number } = {},
  ): Promise<PaginatedResult<OrganizationGroupSummary>> {
    await this.assertOrganizationCoordinator(ctx);
    const page  = Math.max(1, params.page ?? 1);
    const limit = Math.min(500, Math.max(1, params.limit ?? 200));

    return withDb(ctx, async (client) => {
      const orgId = ctx.organizationId ?? ctx.groupId;

      const [{ rows: countRows }, { rows }] = await Promise.all([
        client.query<{ n: string }>(
          `SELECT COUNT(*) AS n
           FROM groups g
           JOIN organization_group_access nga
             ON nga.group_id = g.id AND nga.organization_id = $1 AND nga.is_active = true
           WHERE g.is_active = true`,
          [orgId],
        ),
        client.query<OrganizationGroupSummary>(
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
           JOIN organization_group_access nga
             ON nga.group_id = g.id
             AND nga.organization_id  = $1
             AND nga.is_active = true
           LEFT JOIN group_members gm ON gm.group_id = g.id
           LEFT JOIN contributions c  ON c.group_id  = g.id
           LEFT JOIN loans l          ON l.group_id  = g.id
           LEFT JOIN subscriptions sub
             ON sub.group_id = g.id AND sub.status = 'active'
           WHERE g.is_active = true
           GROUP BY g.id, g.name, g.type, g.county, sub.plan_type, sub.status, g.created_at
           ORDER BY g.name
           LIMIT $2 OFFSET $3`,
          [orgId, limit, (page - 1) * limit],
        ),
      ]);

      const total = parseInt(countRows[0]?.n ?? '0', 10);
      return { items: rows, total, page, pageSize: limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
    });
  },

  async getGroupDetail(ctx: TenantContext, groupId: string): Promise<OrganizationGroupSummary & { monthlyTrend: unknown[] }> {
    await this.assertOrganizationCoordinator(ctx);

    return withDb(ctx, async (client) => {
      // Verify Organization has access to this specific group
      const { rows: access } = await client.query<{ id: string }>(
        `SELECT id FROM organization_group_access
         WHERE organization_id = $1 AND group_id = $2 AND is_active = true`,
        [ctx.organizationId, groupId],
      );
      if (!access[0]) throw new NotFoundError('Group access', groupId);

      const { rows: summary } = await client.query<OrganizationGroupSummary>(
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
