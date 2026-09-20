/**
 * County/ward-level rollup for ONE organization's own linked groups — the
 * organization-axis counterpart to admin-geography.service.ts (platform-wide,
 * super_admin-only). Phase 5 gap analysis: geography was the last missing
 * item on the organization/coordinator axis.
 *
 * This deliberately reuses admin-geography.service.ts's query STRUCTURE
 * verbatim: a `group_stats`/per-group CTE that pre-aggregates each child
 * table PER GROUP FIRST, summed across groups only afterward, plus LATERAL
 * joins for the ward drill-down. That shape exists specifically to avoid a
 * real, proven fan-out bug (a flat join of child tables inflating sums by the
 * OTHER tables' row counts — 30x on loan_book in admin-geography's case,
 * documented in that file's own comment; the identical class of bug hit
 * organization.service.ts's listGroupSummaries too, fixed the same way). The
 * only change here is scoping every group through `organization_group_access`
 * — the same join listGroupSummaries already uses to scope a coordinator's
 * groups to their own organization.
 *
 * `groups.county_id` (FK to `counties`, seeded from IEBC data) is the
 * reliable geography source — NOT `groups.county` (VARCHAR, kept only for
 * backwards compatibility, inconsistent free text) and NOT
 * `funding_programs.geographic_coverage` (an unvalidated jsonb array of
 * arbitrary strings). Ward stays free-text (`groups.ward`) because
 * `ward_id`/`sub_county_id` on `groups` are confirmed-dead, unpopulated
 * columns — same caveat admin-geography.service.ts documents.
 *
 * RLS: uses `withDb` (the app_tenant pool, RLS enforced) — NOT `withAdminDb`.
 * This is one organization's own data, not a platform-wide super_admin view.
 * `groups`, `group_members`, `contributions` and `loans` all already carry an
 * `organization_coordinator` SELECT policy scoped through
 * `organization_group_access` (migration 169's own comment notes "loans,
 * contributions, groups, funding_programs and the organization_* tables
 * already carry the arm"; migration 169 itself added the `group_members` arm
 * this file's member_count relies on). `counties` is readable to every
 * authenticated user regardless of role (migration 031).
 */
import { withDb, type TenantContext } from '@/lib/db';
import type { PoolClient } from 'pg';
import { cached, keys } from '@/lib/redis';
import { organizationService } from './organization.service';
import { ValidationError } from '@/lib/utils/errors';

const orgId = (ctx: TenantContext): string => {
  if (!ctx.organizationId) throw new ValidationError('Organization context is required');
  return ctx.organizationId;
};

export interface OrgCountyAggregationRow {
  county_id: string;
  county_name: string;
  region: string | null;
  group_count: string;
  member_count: string;
  total_contributions: string;
  loan_book: string;
}

export interface OrgWardAggregationRow {
  ward: string;
  group_count: string;
  member_count: string;
  total_contributions: string;
}

export const organizationGeographyService = {
  /**
   * Every county, including ones with zero groups for this organization — a
   * coverage gap is itself signal, per admin-geography.service.ts's own
   * stated principle for the platform-wide version.
   *
   * Cached 120s per organization (same TTL as the platform-wide version) —
   * this is a portfolio-dashboard aggregate, read far more often than the
   * underlying data changes.
   */
  async getCountyAggregation(ctx: TenantContext): Promise<OrgCountyAggregationRow[]> {
    await organizationService.assertOrganizationCoordinator(ctx);
    const organizationId = orgId(ctx);

    return cached(keys.cache('geography-counties', organizationId), 120, () =>
      withDb(ctx, async (db: PoolClient) => {
        const { rows } = await db.query<OrgCountyAggregationRow>(
          `
        -- group_stats pre-aggregates each child table PER GROUP first — see
        -- admin-geography.service.ts's getCountyAggregation for the proven
        -- 30x loan_book inflation a flat join causes here instead.
        WITH linked AS (
          SELECT g.id AS group_id, g.county_id
          FROM groups g
          JOIN organization_group_access nga
            ON nga.group_id = g.id AND nga.organization_id = $1 AND nga.is_active = true
        ),
        group_stats AS (
          SELECT lk.group_id, lk.county_id,
            (SELECT COUNT(*) FROM group_members gm
              WHERE gm.group_id = lk.group_id AND gm.status = 'active') AS member_count,
            (SELECT COALESCE(SUM(amount) FILTER (WHERE status = 'completed'), 0)
               FROM contributions cn WHERE cn.group_id = lk.group_id) AS total_contributions,
            (SELECT COALESCE(SUM(principal_amount) FILTER (WHERE status IN ('active', 'disbursed')), 0)
               FROM loans l WHERE l.group_id = lk.group_id) AS loan_book
          FROM linked lk
        )
        SELECT
          c.id AS county_id, c.name AS county_name, c.region,
          COUNT(DISTINCT gs.group_id) AS group_count,
          COALESCE(SUM(gs.member_count), 0) AS member_count,
          COALESCE(SUM(gs.total_contributions), 0) AS total_contributions,
          COALESCE(SUM(gs.loan_book), 0) AS loan_book
        FROM counties c
        LEFT JOIN group_stats gs ON gs.county_id = c.id
        GROUP BY c.id, c.name, c.region
        ORDER BY group_count DESC, c.name
      `,
          [organizationId],
        );
        return rows;
      }),
    );
  },

  /** Ward breakdown within one county, scoped to this organization's own linked groups. */
  async getWardAggregation(ctx: TenantContext, countyId: string): Promise<OrgWardAggregationRow[]> {
    await organizationService.assertOrganizationCoordinator(ctx);
    const organizationId = orgId(ctx);

    return withDb(ctx, async (db: PoolClient) => {
      const { rows } = await db.query<OrgWardAggregationRow>(
        `
        -- LATERAL per child table — see getCountyAggregation's comment above
        -- for why a flat join fans contributions out across group_members.
        SELECT
          COALESCE(NULLIF(TRIM(g.ward), ''), 'Unspecified') AS ward,
          COUNT(DISTINCT g.id) AS group_count,
          COALESCE(SUM(mem.member_count), 0) AS member_count,
          COALESCE(SUM(con.total_contributions), 0) AS total_contributions
        FROM groups g
        JOIN organization_group_access nga
          ON nga.group_id = g.id AND nga.organization_id = $1 AND nga.is_active = true
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS member_count FROM group_members gm
          WHERE gm.group_id = g.id AND gm.status = 'active'
        ) mem ON true
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(cn.amount) FILTER (WHERE cn.status = 'completed'), 0) AS total_contributions
          FROM contributions cn WHERE cn.group_id = g.id
        ) con ON true
        WHERE g.county_id = $2
        GROUP BY 1
        ORDER BY group_count DESC, ward
      `,
        [organizationId, countyId],
      );
      return rows;
    });
  },
};
