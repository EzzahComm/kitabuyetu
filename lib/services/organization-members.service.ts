/**
 * Multi-staff organizations (Phase 1 of the plan — see
 * docs/adr or the session's plan file for full context). organization_members
 * (migration 101) supersedes organizations.coordinator_member_id (kept,
 * legacy/display-only) as the source of truth for who can act on behalf of
 * an organization.
 *
 * Every function here is called from the super_admin backoffice UI
 * (app/(admin)/admin/organizations/[id]/page.tsx), so — mirroring
 * admin-organizations.service.ts's own established convention exactly —
 * these use withAdminDb (not a tenant ctx + RLS), take an explicit
 * organizationId, and are gated at the route layer (super_admin only), not
 * here. This is deliberately NOT the same shape as members.service.ts
 * (group-scoped, ctx-based, RLS-enforced): organization staff aren't
 * joining a group, so membersService.create()'s linkMemberToGroup() step
 * doesn't apply — only the "find or create a member by phone" part is
 * genuinely shared, reused here via members.service.ts's now-exported
 * generateTempPassword()/BCRYPT_ROUNDS rather than duplicated.
 *
 * The RLS policies on organization_members (org_role = 'lead' required for
 * INSERT/UPDATE) exist for defense-in-depth and for a future self-service
 * path (an org's own lead managing their own staff via the tenant-scoped
 * (enterprise) portal) — not exercised by this admin-only Phase 1 UI, which
 * bypasses them entirely via withAdminDb like every other admin-organizations
 * function already does.
 */
import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import { withAdminDb } from '@/lib/db';
import { normalizePhone } from '@/lib/utils/phone';
import { NotFoundError, ConflictError, ValidationError } from '@/lib/utils/errors';
import { BCRYPT_ROUNDS, generateTempPassword } from './members.service';
import { updatePlatformUserRole } from './admin.service';

export type OrgRole = 'lead' | 'staff';

export interface OrgStaffRow {
  id:         string;
  memberId:   string;
  firstName:  string;
  lastName:   string;
  phone:      string;
  email:      string | null;
  orgRole:    OrgRole;
  status:     'active' | 'archived';
  joinedAt:   Date;
}

interface StaffQueryRow {
  id: string; member_id: string; first_name: string; last_name: string;
  phone: string; email: string | null; org_role: OrgRole; status: 'active' | 'archived';
  joined_at: Date;
}

function mapRow(r: StaffQueryRow): OrgStaffRow {
  return {
    id: r.id, memberId: r.member_id, firstName: r.first_name, lastName: r.last_name,
    phone: r.phone, email: r.email, orgRole: r.org_role, status: r.status, joinedAt: r.joined_at,
  };
}

export async function listOrgStaff(organizationId: string): Promise<OrgStaffRow[]> {
  return withAdminDb(async (db: PoolClient) => {
    const { rows } = await db.query<StaffQueryRow>(
      `SELECT om.id, om.member_id, m.first_name, m.last_name, m.phone, m.email,
              om.org_role, om.status, om.joined_at
       FROM public.organization_members om
       JOIN public.members m ON m.id = om.member_id
       WHERE om.organization_id = $1
       ORDER BY (om.org_role = 'lead') DESC, om.status, m.first_name`,
      [organizationId],
    );
    return rows.map(mapRow);
  });
}

export interface AddOrgStaffInput {
  phone:     string;
  firstName: string;
  lastName:  string;
  orgRole:   OrgRole;
  invitedBy: string; // super_admin's own member id
}

/**
 * Finds or creates a member by phone (mirrors membersService.create()'s
 * find-or-create step, minus the group-linking that doesn't apply here),
 * ensures they hold platform_role = 'organization_coordinator' (only if
 * they don't already hold a DIFFERENT platform role — never silently
 * downgrades an existing super_admin/support assignment), and links them
 * into the organization.
 */
export async function addOrgStaff(
  organizationId: string,
  input: AddOrgStaffInput,
): Promise<OrgStaffRow> {
  const phone = normalizePhone(input.phone);

  return withAdminDb(async (db: PoolClient) => {
    const org = await db.query<{ id: string }>(
      `SELECT id FROM public.organizations WHERE id = $1`,
      [organizationId],
    );
    if (!org.rows[0]) throw new NotFoundError('Organization', organizationId);

    const existing = await db.query<{ id: string; platform_role: string }>(
      `SELECT id, platform_role FROM public.members WHERE phone = $1`,
      [phone],
    );

    let memberId: string;
    if (existing.rows[0]) {
      memberId = existing.rows[0].id;
      const alreadyMember = await db.query(
        `SELECT 1 FROM public.organization_members WHERE organization_id = $1 AND member_id = $2 AND status = 'active'`,
        [organizationId, memberId],
      );
      if (alreadyMember.rows[0]) throw new ConflictError('This person is already active staff for this organization');
      // Never overwrite an existing, different platform-level role (e.g.
      // super_admin/support) — only promote someone who's currently a
      // plain 'member'.
      if (existing.rows[0].platform_role === 'member') {
        await updatePlatformUserRole(memberId, 'organization_coordinator');
      }
    } else {
      const passwordHash = await bcrypt.hash(generateTempPassword(), BCRYPT_ROUNDS);
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO public.members (phone, password_hash, first_name, last_name, platform_role)
         VALUES ($1, $2, $3, $4, 'organization_coordinator')
         RETURNING id`,
        [phone, passwordHash, input.firstName, input.lastName],
      );
      memberId = rows[0].id;
    }

    const { rows: omRows } = await db.query<{ id: string; joined_at: Date }>(
      `INSERT INTO public.organization_members (organization_id, member_id, org_role, invited_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id, member_id)
         DO UPDATE SET status = 'active', org_role = EXCLUDED.org_role, archived_at = NULL, archived_by = NULL
       RETURNING id, joined_at`,
      [organizationId, memberId, input.orgRole, input.invitedBy],
    );

    return {
      id: omRows[0].id, memberId, firstName: input.firstName, lastName: input.lastName,
      phone, email: null, orgRole: input.orgRole, status: 'active', joinedAt: omRows[0].joined_at,
    };
  });
}

export async function changeOrgStaffRole(
  organizationId: string, memberId: string, orgRole: OrgRole,
): Promise<void> {
  return withAdminDb(async (db: PoolClient) => {
    const { rowCount } = await db.query(
      `UPDATE public.organization_members SET org_role = $1
       WHERE organization_id = $2 AND member_id = $3 AND status = 'active'`,
      [orgRole, organizationId, memberId],
    );
    if (!rowCount) throw new NotFoundError('Active organization staff member', memberId);
  });
}

export async function removeOrgStaff(
  organizationId: string, memberId: string, removedBy: string,
): Promise<void> {
  return withAdminDb(async (db: PoolClient) => {
    const remaining = await db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM public.organization_members
       WHERE organization_id = $1 AND status = 'active' AND org_role = 'lead' AND member_id != $2`,
      [organizationId, memberId],
    );
    const target = await db.query<{ org_role: OrgRole }>(
      `SELECT org_role FROM public.organization_members
       WHERE organization_id = $1 AND member_id = $2 AND status = 'active'`,
      [organizationId, memberId],
    );
    if (!target.rows[0]) throw new NotFoundError('Active organization staff member', memberId);
    if (target.rows[0].org_role === 'lead' && parseInt(remaining.rows[0].count, 10) === 0) {
      throw new ValidationError('Cannot remove the last lead — assign another lead first');
    }

    const { rowCount } = await db.query(
      `UPDATE public.organization_members
       SET status = 'archived', archived_at = NOW(), archived_by = $3
       WHERE organization_id = $1 AND member_id = $2 AND status = 'active'`,
      [organizationId, memberId, removedBy],
    );
    if (!rowCount) throw new NotFoundError('Active organization staff member', memberId);
  });
}
