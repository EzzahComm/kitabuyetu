/**
 * Super-admin group-role assignment.
 *
 * Assigning a role means pointing a group_members row at a row in `roles`
 * (the permissions table: system defaults with group_id IS NULL, plus any
 * group-specific custom roles). We update both:
 *
 *   - group_members.role_id  → the detailed role (carries permissions[])
 *   - group_members.role     → the role's base_role enum, so the existing
 *                              enum-based RLS policies and the JWT claim
 *                              issued on the member's next login stay correct.
 *
 * Every assignment writes an audit_logs row (actor, previous/new role, group,
 * organization, IP, user-agent) and an in-app notification to the member, with
 * a best-effort SMS/WhatsApp on top.
 */

import { withAdminDb } from '@/lib/db';
import type { PoolClient } from 'pg';
import { NotFoundError, ValidationError } from '@/lib/utils/errors';
import { logger } from '@/lib/logger';
import { notifyMember } from '@/lib/services/notifications.service';

export interface AssignableRole {
  id:          string;
  code:        string;
  name:        string;
  description: string | null;
  base_role:   string;
  rank:        number;
  is_system:   boolean;
  permissions: string[];
}

/**
 * Roles a member of `groupId` can be assigned: the platform system roles
 * (group_id IS NULL) plus any custom roles defined for that group. Highest
 * rank first so the UI can present them most-privileged → least.
 */
export async function listAssignableRoles(groupId: string): Promise<AssignableRole[]> {
  return withAdminDb(async (db: PoolClient) => {
    const { rows } = await db.query<AssignableRole>(
      `SELECT id, code, name, description, base_role, rank, is_system, permissions
         FROM public.roles
        WHERE group_id IS NULL OR group_id = $1
        ORDER BY rank DESC, name ASC`,
      [groupId],
    );
    return rows;
  });
}

interface MembershipRow {
  member_id:       string;
  group_id:        string;
  first_name:      string;
  last_name:       string;
  phone:           string | null;
  group_name:      string;
  organization_id: string | null;
  current_role:    string;
  current_role_id: string | null;
  current_role_name: string | null;
}

export interface AssignRoleResult {
  success:      true;
  memberId:     string;
  groupId:      string;
  previousRole: { id: string | null; name: string | null; base: string };
  newRole:      { id: string; name: string; base: string };
  notification: { inApp: boolean; channel: string; status: string };
}

/**
 * Assign (or change) a member's role within a specific group. Super-admin only
 * — the caller is authorized by the route (withPlatformRole('super_admin')).
 */
export async function assignGroupMemberRole(input: {
  actorId:   string;
  memberId:  string;
  groupId:   string;
  roleId:    string;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<AssignRoleResult> {
  const { actorId, memberId, groupId, roleId, ipAddress, userAgent } = input;

  // ── Phase 1: all DB writes in one transaction (update + audit + in-app) ──
  const txn = await withAdminDb(async (db: PoolClient) => {
    const { rows: memberships } = await db.query<MembershipRow>(
      `SELECT gm.member_id,
              gm.group_id,
              m.first_name,
              m.last_name,
              m.phone,
              g.name AS group_name,
              (SELECT nga.organization_id
                 FROM public.organization_group_access nga
                WHERE nga.group_id = gm.group_id AND nga.is_active
                ORDER BY nga.created_at ASC
                LIMIT 1) AS organization_id,
              gm.role     AS current_role,
              gm.role_id  AS current_role_id,
              cr.name     AS current_role_name
         FROM public.group_members gm
         JOIN public.members m ON m.id = gm.member_id
         JOIN public.groups  g ON g.id = gm.group_id
         LEFT JOIN public.roles cr ON cr.id = gm.role_id
        WHERE gm.group_id = $1 AND gm.member_id = $2`,
      [groupId, memberId],
    );
    const membership = memberships[0];
    if (!membership) {
      throw new NotFoundError('Group membership', `${memberId} in group ${groupId}`);
    }

    // ── Validate the role is assignable to this group ───────────────────
    const { rows: roleRows } = await db.query<AssignableRole>(
      `SELECT id, code, name, description, base_role, rank, is_system, permissions
         FROM public.roles
        WHERE id = $1 AND (group_id IS NULL OR group_id = $2)`,
      [roleId, groupId],
    );
    const role = roleRows[0];
    if (!role) {
      throw new ValidationError('Selected role is not assignable to this group');
    }

    // No-op guard: nothing to change, no audit/notification noise.
    if (membership.current_role_id === role.id) {
      return { membership, role, changed: false as const, inApp: false };
    }

    // ── Apply: role_id (permissions) + role (base enum for RLS/JWT) ──────
    await db.query(
      `UPDATE public.group_members
          SET role_id = $1, role = $2::member_role, updated_at = NOW()
        WHERE group_id = $3 AND member_id = $4`,
      [role.id, role.base_role, groupId, memberId],
    );

    // ── Audit: actor, prev→new role, group, org, IP, user-agent ─────────
    await db.query(
      `INSERT INTO audit_logs
         (group_id, actor_id, action, resource_type, resource_id, old_values, new_values, ip_address, user_agent)
       VALUES ($1, $2, 'member.role_assigned', 'group_member', $3, $4::jsonb, $5::jsonb, $6, $7)`,
      [
        groupId,
        actorId,
        memberId,
        JSON.stringify({
          role_id:   membership.current_role_id,
          role_name: membership.current_role_name,
          base_role: membership.current_role,
        }),
        JSON.stringify({
          role_id:         role.id,
          role_name:       role.name,
          base_role:       role.base_role,
          organization_id: membership.organization_id,
          group_id:        groupId,
        }),
        ipAddress ?? null,
        userAgent ?? null,
      ],
    );

    // ── In-app notification, isolated by a SAVEPOINT so a failure here
    //    can't abort the (already-written) role change + audit. ──────────
    const body = `Your role in ${membership.group_name} is now ${role.name}.`;
    let inApp = false;
    try {
      await db.query('SAVEPOINT notif');
      await db.query(
        `INSERT INTO notifications
           (group_id, member_id, type, title, body, reference_type, reference_id)
         VALUES ($1, $2, 'in_app', $3, $4, 'role_assignment', $5)`,
        [groupId, memberId, 'Role updated', body, memberId],
      );
      await db.query('RELEASE SAVEPOINT notif');
      inApp = true;
    } catch (err) {
      await db.query('ROLLBACK TO SAVEPOINT notif');
      logger.error('[member-roles] in-app notification failed', { memberId, groupId, err });
    }

    return { membership, role, changed: true as const, inApp };
  });

  const { membership, role, changed } = txn;

  const baseResult: AssignRoleResult = {
    success: true,
    memberId, groupId,
    previousRole: { id: membership.current_role_id, name: membership.current_role_name, base: membership.current_role },
    newRole:      { id: role.id, name: role.name, base: role.base_role },
    notification: { inApp: txn.inApp, channel: 'none', status: changed ? 'skipped' : 'unchanged' },
  };

  if (!changed) return baseResult;

  // ── Phase 2: external SMS/WhatsApp AFTER commit (never blocks the change) ──
  if (membership.phone) {
    try {
      const out = await notifyMember({
        groupId, memberId,
        phone: membership.phone,
        body:  `KitabuYetu: Your role in ${membership.group_name} is now ${role.name}.`,
        referenceType: 'role_assignment',
        referenceId:   memberId,
        // Phase 2b (docs/messaging/UNIFIED_MESSAGING_ARCHITECTURE.md Decision B):
        // bundled allowance now exists, so this real send-path bills.
        billingMode:   'billed',
      });
      baseResult.notification.channel = out.channel;
      baseResult.notification.status  = out.status;
    } catch (err) {
      logger.error('[member-roles] SMS/WhatsApp notify failed', { memberId, err });
      baseResult.notification.status = 'failed';
    }
  }

  logger.info('[member-roles] role assigned', {
    actorId, memberId, groupId,
    from: membership.current_role_name ?? membership.current_role,
    to:   role.name,
  });

  return baseResult;
}
