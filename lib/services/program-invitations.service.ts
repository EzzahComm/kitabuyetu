/**
 * Organization-initiated invitations for a group to join a program. Mirrors
 * organization-group-links.service.ts's request/respond shape, but the
 * initiating side is reversed: the organization invites, the group's
 * chairperson accepts or declines. No platform-admin gate — the spec is
 * explicit that routine program membership doesn't need Kitabu Yetu
 * approval, only the two parties involved.
 *
 * Acceptance activates a program_memberships row via
 * activateProgramMembership — see programs.service.ts.
 */
import { DatabaseError, type PoolClient } from 'pg';
import { withDb, withAdminDb, type TenantContext } from '@/lib/db';
import { organizationService } from './organization.service';
import { programsService, activateProgramMembership, type ProgramMembershipRow } from './programs.service';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/utils/errors';

export type ProgramInvitationStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';

export interface ProgramInvitationRow {
  id: string;
  programId: string;
  programName: string;
  groupId: string;
  groupName: string;
  invitedBy: string;
  message: string | null;
  status: ProgramInvitationStatus;
  expiresAt: string | null;
  acceptedAt: string | null;
  declinedAt: string | null;
  createdAt: string;
}

const ROW_SELECT = `
  SELECT pi.id, pi.program_id AS "programId", p.name AS "programName",
         pi.group_id AS "groupId", g.name AS "groupName", pi.invited_by AS "invitedBy",
         pi.message, pi.status, pi.expires_at AS "expiresAt",
         pi.accepted_at AS "acceptedAt", pi.declined_at AS "declinedAt", pi.created_at AS "createdAt"
  FROM   program_invitations pi
  JOIN   programs p ON p.id = pi.program_id
  JOIN   groups g ON g.id = pi.group_id
`;

async function loadForUpdate(
  client: PoolClient,
  id: string,
): Promise<{ programId: string; groupId: string; status: ProgramInvitationStatus } | undefined> {
  const { rows } = await client.query<{ program_id: string; group_id: string; status: ProgramInvitationStatus }>(
    `SELECT program_id, group_id, status FROM program_invitations WHERE id = $1 FOR UPDATE`,
    [id],
  );
  return rows[0] ? { programId: rows[0].program_id, groupId: rows[0].group_id, status: rows[0].status } : undefined;
}

export const programInvitationsService = {
  /** Org coordinator invites a group, found by its group code, to a program they own. */
  async inviteGroup(
    ctx: TenantContext,
    programId: string,
    groupCode: string,
    message?: string,
  ): Promise<ProgramInvitationRow> {
    await organizationService.assertOrganizationCoordinator(ctx);
    await programsService.assertOwnedByOrganization(ctx, programId);

    try {
      return await withAdminDb(async (client) => {
        const { rows: groups } = await client.query<{ id: string }>(
          `SELECT id FROM groups WHERE is_active = true AND group_code = $1`,
          [groupCode.trim().toUpperCase()],
        );
        if (!groups[0]) throw new NotFoundError('Group', groupCode);

        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO program_invitations (program_id, group_id, invited_by, message, status)
           VALUES ($1, $2, $3, $4, 'pending')
           RETURNING id`,
          [programId, groups[0].id, ctx.userId, message ?? null],
        );
        await client.query(
          `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id)
           VALUES ($1, 'programInvitation.invite', 'program_invitation', $2)`,
          [ctx.userId, rows[0].id],
        );
        const { rows: full } = await client.query<ProgramInvitationRow>(`${ROW_SELECT} WHERE pi.id = $1`, [rows[0].id]);
        return full[0];
      });
    } catch (err) {
      if (
        err instanceof DatabaseError &&
        err.code === '23505' &&
        err.constraint === 'idx_program_invitations_one_pending'
      ) {
        throw new ConflictError('This group already has a pending invitation for this program');
      }
      throw err;
    }
  },

  /** Org coordinator cancels an invitation that hasn't been responded to yet. */
  async cancelInvitation(ctx: TenantContext, id: string): Promise<ProgramInvitationRow> {
    await organizationService.assertOrganizationCoordinator(ctx);
    return withAdminDb(async (client) => {
      const existing = await loadForUpdate(client, id);
      if (!existing) throw new NotFoundError('Program invitation', id);
      await programsService.assertOwnedByOrganization(ctx, existing.programId);
      if (existing.status !== 'pending') {
        throw new ValidationError(`Cannot cancel an invitation in status '${existing.status}'`);
      }
      await client.query(`UPDATE program_invitations SET status = 'cancelled' WHERE id = $1`, [id]);
      await client.query(
        `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id)
         VALUES ($1, 'programInvitation.cancel', 'program_invitation', $2)`,
        [ctx.userId, id],
      );
      const { rows } = await client.query<ProgramInvitationRow>(`${ROW_SELECT} WHERE pi.id = $1`, [id]);
      return rows[0];
    });
  },

  async listForProgram(ctx: TenantContext, programId: string): Promise<ProgramInvitationRow[]> {
    await programsService.assertOwnedByOrganization(ctx, programId);
    return withAdminDb(async (client) => {
      const { rows } = await client.query<ProgramInvitationRow>(
        `${ROW_SELECT} WHERE pi.program_id = $1 ORDER BY pi.created_at DESC`,
        [programId],
      );
      return rows;
    });
  },

  /** The calling group's own invitations, every status. */
  async listForGroup(ctx: TenantContext): Promise<ProgramInvitationRow[]> {
    if (!ctx.groupId) throw new ValidationError('Group context is required');
    return withDb(ctx, async (client) => {
      const { rows } = await client.query<ProgramInvitationRow>(
        `${ROW_SELECT} WHERE pi.group_id = $1 ORDER BY pi.created_at DESC`,
        [ctx.groupId],
      );
      return rows;
    });
  },

  /** Group chairperson accepts — idempotent, activates a program_memberships row. */
  async acceptInvitation(
    ctx: TenantContext,
    id: string,
  ): Promise<{ invitation: ProgramInvitationRow; membership: ProgramMembershipRow }> {
    if (ctx.role !== 'chairperson') throw new ForbiddenError('Only the chairperson can accept a program invitation');
    if (!ctx.groupId) throw new ValidationError('Group context is required');
    return withAdminDb(async (client) => {
      const existing = await loadForUpdate(client, id);
      if (!existing) throw new NotFoundError('Program invitation', id);
      if (existing.groupId !== ctx.groupId) throw new NotFoundError('Program invitation', id);

      if (existing.status !== 'accepted') {
        if (existing.status !== 'pending') {
          throw new ValidationError(`Cannot accept an invitation in status '${existing.status}'`);
        }
        await client.query(`UPDATE program_invitations SET status = 'accepted', accepted_at = NOW() WHERE id = $1`, [
          id,
        ]);
        await client.query(
          `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id)
           VALUES ($1, 'programInvitation.accept', 'program_invitation', $2)`,
          [ctx.userId, id],
        );
      }

      const membership = await activateProgramMembership(client, existing.programId, existing.groupId, 'invitation');
      const { rows } = await client.query<ProgramInvitationRow>(`${ROW_SELECT} WHERE pi.id = $1`, [id]);
      return { invitation: rows[0], membership };
    });
  },

  /** Group chairperson declines. */
  async declineInvitation(ctx: TenantContext, id: string): Promise<ProgramInvitationRow> {
    if (ctx.role !== 'chairperson') throw new ForbiddenError('Only the chairperson can decline a program invitation');
    if (!ctx.groupId) throw new ValidationError('Group context is required');
    return withAdminDb(async (client) => {
      const existing = await loadForUpdate(client, id);
      if (!existing) throw new NotFoundError('Program invitation', id);
      if (existing.groupId !== ctx.groupId) throw new NotFoundError('Program invitation', id);
      if (existing.status !== 'pending') {
        throw new ValidationError(`Cannot decline an invitation in status '${existing.status}'`);
      }
      await client.query(`UPDATE program_invitations SET status = 'declined', declined_at = NOW() WHERE id = $1`, [id]);
      await client.query(
        `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id)
         VALUES ($1, 'programInvitation.decline', 'program_invitation', $2)`,
        [ctx.userId, id],
      );
      const { rows } = await client.query<ProgramInvitationRow>(`${ROW_SELECT} WHERE pi.id = $1`, [id]);
      return rows[0];
    });
  },
};
