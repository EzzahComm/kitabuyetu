/**
 * Super-admin management of ORGANIZATIONS — the federating bodies (banks,
 * SACCOs, foundations) that oversee many groups via organization_group_access.
 *
 * Distinct from admin.service.ts, which manages GROUPS (the platform tenants).
 * Every function here is super_admin-only (enforced at the route) and reads/
 * writes the `organizations`, `organization_group_access`, and
 * `organization_wallets` tables.
 */
import { withAdminDb } from '@/lib/db';
import type { PoolClient } from 'pg';
import { organizationAccountingService } from './organization-accounting.service';
import { assertLinkedGroupCap } from './organization-plan.service';

export const ORGANIZATION_TYPES = [
  'bank', 'sacco', 'foundation', 'ngo',
  'government', 'cooperative', 'faith_based', 'other',
] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export interface OrgListParams {
  page:    number;
  limit:   number;
  search?: string;
  type?:   string;
  status?: string;   // 'active' | 'inactive'
}

/**
 * List organizations with a rollup summary per row: how many groups they
 * oversee, the member reach across those groups, and their wallet balance.
 */
export async function listOrganizations(params: OrgListParams) {
  return withAdminDb(async (db: PoolClient) => {
    const { page, limit, search, type, status } = params;
    const offset = (page - 1) * limit;
    const conds: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;

    if (search) {
      conds.push(`(o.name ILIKE $${idx} OR o.registration_number ILIKE $${idx})`);
      vals.push(`%${search}%`); idx++;
    }
    if (type) {
      conds.push(`o.type = $${idx}::organization_type`);
      vals.push(type); idx++;
    }
    if (status === 'active')   conds.push(`o.is_active = true`);
    if (status === 'inactive') conds.push(`o.is_active = false`);

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const [data, count] = await Promise.all([
      db.query(`
        SELECT
          o.id, o.name, o.type, o.registration_number, o.phone, o.email,
          o.county, o.is_active, o.created_at,
          m.first_name || ' ' || m.last_name AS coordinator_name,
          COALESCE(ga.group_count, 0)          AS group_count,
          COALESCE(ga.member_reach, 0)         AS member_reach,
          COALESCE(w.available_balance, 0)     AS wallet_balance,
          COALESCE(w.total_disbursed, 0)       AS total_disbursed
        FROM public.organizations o
        LEFT JOIN public.members m ON m.id = o.coordinator_member_id
        LEFT JOIN LATERAL (
          SELECT COUNT(DISTINCT oga.group_id) AS group_count,
                 COUNT(DISTINCT gm.id)         AS member_reach
          FROM public.organization_group_access oga
          LEFT JOIN public.group_members gm
            ON gm.group_id = oga.group_id AND gm.status = 'active'
          WHERE oga.organization_id = o.id AND oga.is_active
        ) ga ON true
        LEFT JOIN public.organization_wallets w
          ON w.organization_id = o.id AND w.currency = 'KES'
        ${where}
        ORDER BY o.created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `, [...vals, limit, offset]),
      db.query(`SELECT COUNT(*) AS total FROM public.organizations o ${where}`, vals),
    ]);

    return { items: data.rows, total: parseInt(count.rows[0].total, 10), page, limit };
  });
}

/**
 * Side-by-side comparison rollup across every active organization —
 * SUPER_ADMIN_PLATFORM_AUDIT.md Phase 3. Reuses listOrganizations' own
 * group_count/member_reach/wallet SQL shape and adds each org's average
 * governance health score (governance_health_scores, Phase 2), averaged
 * across the groups it oversees via organization_group_access. Unpaginated
 * (organizations are a small federating-body count, not a tenant-scale
 * list) — capped defensively rather than exposed as a page param.
 */
export async function compareOrganizations() {
  return withAdminDb(async (db: PoolClient) => {
    const { rows } = await db.query(`
      SELECT
        o.id, o.name, o.type, o.county, o.is_active,
        COALESCE(ga.group_count, 0)      AS group_count,
        COALESCE(ga.member_reach, 0)     AS member_reach,
        COALESCE(w.available_balance, 0) AS wallet_balance,
        COALESCE(w.total_disbursed, 0)   AS total_disbursed,
        ROUND(hs.avg_health_score)       AS avg_health_score
      FROM public.organizations o
      LEFT JOIN LATERAL (
        SELECT COUNT(DISTINCT oga.group_id) AS group_count,
               COUNT(DISTINCT gm.id)         AS member_reach
        FROM public.organization_group_access oga
        LEFT JOIN public.group_members gm
          ON gm.group_id = oga.group_id AND gm.status = 'active'
        WHERE oga.organization_id = o.id AND oga.is_active
      ) ga ON true
      LEFT JOIN public.organization_wallets w
        ON w.organization_id = o.id AND w.currency = 'KES'
      LEFT JOIN LATERAL (
        SELECT AVG(h.score) AS avg_health_score
        FROM public.organization_group_access oga2
        JOIN LATERAL (
          SELECT score FROM public.governance_health_scores h2
          WHERE h2.group_id = oga2.group_id ORDER BY h2.as_of DESC LIMIT 1
        ) h ON true
        WHERE oga2.organization_id = o.id AND oga2.is_active
      ) hs ON true
      WHERE o.is_active = true
      ORDER BY o.name
      LIMIT 200
    `);
    return rows;
  });
}

/**
 * One organization with its summary, the groups it oversees (each with a
 * member/contribution rollup), and the pool of active groups not yet assigned
 * — everything the detail + assignment UI needs in a single call.
 */
export async function getOrganizationDetail(orgId: string) {
  return withAdminDb(async (db: PoolClient) => {
    const [org, assigned, assignable, wallet] = await Promise.all([
      db.query(`
        SELECT o.*, m.first_name || ' ' || m.last_name AS coordinator_name,
               m.phone AS coordinator_phone, m.email AS coordinator_email
        FROM public.organizations o
        LEFT JOIN public.members m ON m.id = o.coordinator_member_id
        WHERE o.id = $1
        LIMIT 1
      `, [orgId]),
      db.query(`
        SELECT
          oga.group_id, oga.access_level, oga.granted_at,
          g.name AS group_name, g.group_code, g.type AS group_type,
          g.onboarding_status,
          COUNT(DISTINCT gm.id) FILTER (WHERE gm.status = 'active') AS member_count,
          COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'completed'), 0) AS total_contributions
        FROM public.organization_group_access oga
        JOIN public.groups g ON g.id = oga.group_id
        LEFT JOIN public.group_members gm ON gm.group_id = g.id
        LEFT JOIN public.contributions c ON c.group_id = g.id
        WHERE oga.organization_id = $1 AND oga.is_active
        GROUP BY oga.group_id, oga.access_level, oga.granted_at,
                 g.name, g.group_code, g.type, g.onboarding_status
        ORDER BY g.name
      `, [orgId]),
      db.query(`
        SELECT g.id, g.name, g.group_code, g.type AS group_type
        FROM public.groups g
        WHERE g.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM public.organization_group_access oga
            WHERE oga.group_id = g.id AND oga.organization_id = $1 AND oga.is_active
          )
        ORDER BY g.name
        LIMIT 500
      `, [orgId]),
      db.query(`
        SELECT currency, available_balance, committed_balance,
               total_deposited, total_disbursed, total_returned
        FROM public.organization_wallets
        WHERE organization_id = $1
        ORDER BY currency
      `, [orgId]),
    ]);

    if (!org.rows[0]) return null;
    return {
      ...org.rows[0],
      assignedGroups:   assigned.rows,
      assignableGroups: assignable.rows,
      wallets:          wallet.rows,
    };
  });
}

export async function createOrganization(input: {
  name: string;
  type: string;
  registrationNumber?: string;
  phone?: string;
  email?: string;
  county?: string;
  address?: string;
}) {
  return withAdminDb(async (db: PoolClient) => {
    const { rows } = await db.query(`
      INSERT INTO public.organizations
        (name, type, registration_number, phone, email, county, address, is_active)
      VALUES ($1, $2::organization_type, $3, $4, $5, $6, $7, true)
      RETURNING id, name, type
    `, [
      input.name.trim(),
      input.type,
      input.registrationNumber?.trim() || null,
      input.phone?.trim() || null,
      input.email?.trim() || null,
      input.county?.trim() || null,
      input.address?.trim() || null,
    ]);
    await organizationAccountingService.seedDefaultAccountsInTx(db, rows[0].id);
    return rows[0];
  });
}

export async function setOrganizationActive(orgId: string, isActive: boolean) {
  return withAdminDb(async (db: PoolClient) => {
    await db.query(
      `UPDATE public.organizations SET is_active = $1 WHERE id = $2`,
      [isActive, orgId],
    );
    return { success: true };
  });
}

/**
 * Assign a group to an organization (organization_group_access). Idempotent:
 * re-assigning a previously revoked group reactivates the existing row.
 */
export async function assignGroupToOrganization(
  orgId: string, groupId: string, grantedBy: string, accessLevel: 'read' | 'report' = 'read',
) {
  return withAdminDb(async (db: PoolClient) => {
    await assertLinkedGroupCap(db, orgId, groupId);
    await db.query(`
      INSERT INTO public.organization_group_access
        (organization_id, group_id, access_level, granted_by, is_active)
      VALUES ($1, $2, $3::organization_access_level, $4, true)
      ON CONFLICT (organization_id, group_id) DO UPDATE SET
        is_active    = true,
        access_level = EXCLUDED.access_level,
        granted_by   = EXCLUDED.granted_by,
        granted_at   = NOW(),
        revoked_at   = NULL,
        revoked_by   = NULL
    `, [orgId, groupId, accessLevel, grantedBy]);
    return { success: true };
  });
}

export async function revokeGroupFromOrganization(
  orgId: string, groupId: string, revokedBy: string,
) {
  return withAdminDb(async (db: PoolClient) => {
    await db.query(`
      UPDATE public.organization_group_access
      SET is_active = false, revoked_at = NOW(), revoked_by = $3
      WHERE organization_id = $1 AND group_id = $2 AND is_active
    `, [orgId, groupId, revokedBy]);
    return { success: true };
  });
}
