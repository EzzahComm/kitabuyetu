import { withDb, type TenantContext } from '@/lib/db';
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/utils/errors';
import type { OrganizationGroupSummary, OrganizationProfile } from '@/types/api.types';
import type { PaginatedResult } from '@/types/db.types';
import { assertWhiteLabelAccess } from './organization-plan.service';

// PRODUCTION_READINESS_AUDIT Pass 1 (docs/audit/01-HYPOTHESIS-VERIFICATION.md,
// H3): the 3 call sites below used to fall back to `ctx.groupId` when
// `ctx.organizationId` was absent. Not exploitable — on the
// /api/v1/organization/* carve-out `ctx.groupId` is always the empty string
// the proxy stamps, never client-influenced, so the fallback only ever
// degraded to "0 rows match organization_id=''" — but it's a silent
// wrong-answer rather than a loud one for a super_admin token minted with no
// organizationId claim. Throws instead now, mirroring the identical
// throw-on-missing helper already in organization-finance.service.ts.
const orgId = (ctx: TenantContext): string => {
  if (!ctx.organizationId) throw new ValidationError('Organization context is required');
  return ctx.organizationId;
};

export interface OrganizationBranding {
  logoUrl:      string | null;
  primaryColor: string | null;
}

export interface OrganizationAuditLogRow {
  id:           string;
  groupId:      string | null;
  groupName:    string | null;
  actorId:      string | null;
  actorName:    string | null;
  action:       string;
  resourceType: string;
  resourceId:   string | null;
  createdAt:    string;
}

export interface OrganizationMemberRow {
  memberId:   string;
  firstName:  string;
  lastName:   string;
  phone:      string;
  email:      string | null;
  groupId:    string;
  groupName:  string;
  role:       string;
  isActive:   boolean;
  joinedAt:   string;
}

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
   * White-label branding — logo + primary color only (migration 109,
   * ORGANIZATION_LOGIN_ARCHITECTURE_AUDIT.md Phase 4; custom domain
   * explicitly deferred, see the audit's Phase 4/Phase 5 notes).
   */
  async getBranding(ctx: TenantContext): Promise<OrganizationBranding> {
    await this.assertOrganizationCoordinator(ctx);
    return withDb(ctx, async (client) => {
      const { rows } = await client.query<OrganizationBranding>(
        `SELECT logo_url AS "logoUrl", primary_color AS "primaryColor" FROM organizations WHERE id = $1`,
        [ctx.organizationId],
      );
      if (!rows[0]) throw new NotFoundError('Organization', ctx.organizationId ?? '');
      return rows[0];
    });
  },

  async setBranding(
    ctx: TenantContext,
    input: { logoUrl?: string | null; primaryColor?: string | null },
  ): Promise<OrganizationBranding> {
    await this.assertOrganizationCoordinator(ctx);
    return withDb(ctx, async (client) => {
      await assertWhiteLabelAccess(client, orgId(ctx));
      const { rows } = await client.query<OrganizationBranding>(
        `UPDATE organizations
         SET logo_url = $2, primary_color = $3
         WHERE id = $1
         RETURNING logo_url AS "logoUrl", primary_color AS "primaryColor"`,
        [ctx.organizationId, input.logoUrl ?? null, input.primaryColor ?? null],
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
      const organizationId = orgId(ctx);

      const [{ rows: countRows }, { rows }] = await Promise.all([
        client.query<{ n: string }>(
          `SELECT COUNT(*) AS n
           FROM groups g
           JOIN organization_group_access nga
             ON nga.group_id = g.id AND nga.organization_id = $1 AND nga.is_active = true
           WHERE g.is_active = true`,
          [organizationId],
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
           -- LATERAL, not a plain join: since migration 127 a group can hold
           -- one active subscription per product. A plain join would multiply
           -- every contributions/loans row by the number of products and
           -- inflate the un-DISTINCTed SUM(c.amount) / COUNT(l.id) above, as
           -- well as listing the group once per product. Scoped to
           -- kitabu_yetu because this is an organization's window onto the
           -- savings/loan financials of groups it oversees — a group's Chama
           -- Reminder subscription is not an organization's concern, and NULL
           -- correctly reads as "no Kitabu Yetu plan".
           LEFT JOIN LATERAL (
             SELECT s.plan_type, s.status FROM subscriptions s
             WHERE s.group_id = g.id AND s.status = 'active'
               AND s.product = 'kitabu_yetu'
             LIMIT 1
           ) sub ON true
           WHERE g.is_active = true
           GROUP BY g.id, g.name, g.type, g.county, sub.plan_type, sub.status, g.created_at
           ORDER BY g.name
           LIMIT $2 OFFSET $3`,
          [organizationId, limit, (page - 1) * limit],
        ),
      ]);

      const total = parseInt(countRows[0]?.n ?? '0', 10);
      return { items: rows, total, page, pageSize: limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
    });
  },

  /**
   * Customer members across every branch (group) linked to this
   * organization — distinct from organization-members.service.ts, which
   * lists this org's own STAFF (coordinators/leads), not its customers.
   * ORGANIZATION_LOGIN_ARCHITECTURE_AUDIT.md Phase 4 — the enterprise
   * portal's "Members" nav item had no backend at all until this.
   */
  async listMembers(
    ctx: TenantContext,
    params: { page?: number; limit?: number; search?: string } = {},
  ): Promise<PaginatedResult<OrganizationMemberRow>> {
    await this.assertOrganizationCoordinator(ctx);
    const page   = Math.max(1, params.page ?? 1);
    const limit  = Math.min(100, Math.max(1, params.limit ?? 25));
    const search = params.search?.trim();

    return withDb(ctx, async (client) => {
      const organizationId = orgId(ctx);
      const searchPattern = search ? `%${search}%` : null;
      // Distinct placeholder numbering per query — the count query has no
      // limit/offset params, so `search` sits at a different position than
      // in the list query below.
      const countSearchClause = search ? `AND (m.first_name || ' ' || m.last_name ILIKE $2 OR m.phone ILIKE $2)` : '';
      const listSearchClause  = search ? `AND (m.first_name || ' ' || m.last_name ILIKE $4 OR m.phone ILIKE $4)` : '';

      const [{ rows: countRows }, { rows }] = await Promise.all([
        client.query<{ n: string }>(
          `SELECT COUNT(*) AS n
           FROM group_members gm
           JOIN groups g ON g.id = gm.group_id
           JOIN organization_group_access nga
             ON nga.group_id = g.id AND nga.organization_id = $1 AND nga.is_active = true
           JOIN members m ON m.id = gm.member_id
           WHERE g.is_active = true ${countSearchClause}`,
          search ? [organizationId, searchPattern] : [organizationId],
        ),
        client.query<OrganizationMemberRow>(
          `SELECT
             m.id                AS "memberId",
             m.first_name        AS "firstName",
             m.last_name         AS "lastName",
             m.phone,
             m.email,
             g.id                AS "groupId",
             g.name              AS "groupName",
             gm.role::text       AS "role",
             gm.is_active        AS "isActive",
             gm.joined_at::text  AS "joinedAt"
           FROM group_members gm
           JOIN groups g ON g.id = gm.group_id
           JOIN organization_group_access nga
             ON nga.group_id = g.id AND nga.organization_id = $1 AND nga.is_active = true
           JOIN members m ON m.id = gm.member_id
           WHERE g.is_active = true ${listSearchClause}
           ORDER BY m.first_name, m.last_name
           LIMIT $2 OFFSET $3`,
          search
            ? [organizationId, limit, (page - 1) * limit, searchPattern]
            : [organizationId, limit, (page - 1) * limit],
        ),
      ]);

      const total = parseInt(countRows[0]?.n ?? '0', 10);
      return { items: rows, total, page, pageSize: limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
    });
  },

  /**
   * Audit trail scoped to this organization's own branches —
   * `audit_logs.group_id` is the only scoping column that table has (no
   * `organization_id`), so this joins through `organization_group_access`
   * rather than filtering directly. Mirrors admin.service.ts's platform-wide
   * `listAuditLogs`, narrowed to one organization's groups.
   * ORGANIZATION_LOGIN_ARCHITECTURE_AUDIT.md Phase 4.
   */
  async listAuditLogs(
    ctx: TenantContext,
    params: { page?: number; limit?: number; search?: string } = {},
  ): Promise<PaginatedResult<OrganizationAuditLogRow>> {
    await this.assertOrganizationCoordinator(ctx);
    const page   = Math.max(1, params.page ?? 1);
    const limit  = Math.min(100, Math.max(1, params.limit ?? 25));
    const search = params.search?.trim();

    return withDb(ctx, async (client) => {
      const organizationId = orgId(ctx);
      const searchClause = search ? `AND al.resource_type ILIKE $2` : '';
      const searchParam  = search ? [`%${search}%`] : [];

      const [{ rows: countRows }, { rows }] = await Promise.all([
        client.query<{ n: string }>(
          `SELECT COUNT(*) AS n
           FROM audit_logs al
           WHERE al.group_id IN (
             SELECT group_id FROM organization_group_access
             WHERE organization_id = $1 AND is_active = true
           ) ${searchClause}`,
          [organizationId, ...searchParam],
        ),
        client.query<OrganizationAuditLogRow>(
          `SELECT
             al.id,
             al.group_id                          AS "groupId",
             g.name                                AS "groupName",
             al.actor_id                          AS "actorId",
             (m.first_name || ' ' || m.last_name)  AS "actorName",
             al.action,
             al.resource_type                     AS "resourceType",
             al.resource_id::text                 AS "resourceId",
             al.created_at::text                  AS "createdAt"
           FROM audit_logs al
           LEFT JOIN groups g  ON g.id = al.group_id
           LEFT JOIN members m ON m.id = al.actor_id
           WHERE al.group_id IN (
             SELECT group_id FROM organization_group_access
             WHERE organization_id = $1 AND is_active = true
           ) ${searchClause}
           ORDER BY al.created_at DESC
           LIMIT $${search ? 3 : 2} OFFSET $${search ? 4 : 3}`,
          [organizationId, ...searchParam, limit, (page - 1) * limit],
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
         -- Same LATERAL fix and same kitabu_yetu scoping as the list query
         -- above — see its comment for why a plain join corrupts the
         -- aggregates here (migration 127).
         LEFT JOIN LATERAL (
           SELECT s.plan_type, s.status FROM subscriptions s
           WHERE s.group_id = g.id AND s.status = 'active'
             AND s.product = 'kitabu_yetu'
           LIMIT 1
         ) sub ON true
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
