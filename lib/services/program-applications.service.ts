/**
 * Group-initiated applications to a published program. Mirrors
 * ecosystem.service.ts's submit/review shape (submitted → under_review →
 * accepted/declined/additional_information_requested), with the row-lock +
 * audit_logs convention from organization-group-links.service.ts since this
 * is a decision workflow, not a simple insert.
 *
 * Acceptance activates a program_memberships row via
 * activateProgramMembership — see programs.service.ts.
 */
import { DatabaseError, type PoolClient } from 'pg';
import { withDb, withAdminDb, type TenantContext } from '@/lib/db';
import { organizationService } from './organization.service';
import { programsService, activateProgramMembership, type ProgramMembershipRow } from './programs.service';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/utils/errors';

export type ProgramApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'additional_information_requested'
  | 'accepted'
  | 'declined'
  | 'withdrawn';

export interface ProgramApplicationRow {
  id: string;
  programId: string;
  programName: string;
  groupId: string;
  groupName: string;
  submittedBy: string;
  status: ProgramApplicationStatus;
  applicationData: Record<string, unknown>;
  reviewNotes: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const ROW_SELECT = `
  SELECT pa.id, pa.program_id AS "programId", p.name AS "programName",
         pa.group_id AS "groupId", g.name AS "groupName", pa.submitted_by AS "submittedBy",
         pa.status, pa.application_data AS "applicationData", pa.review_notes AS "reviewNotes",
         pa.reviewed_by AS "reviewedBy", pa.reviewed_at AS "reviewedAt",
         pa.created_at AS "createdAt", pa.updated_at AS "updatedAt"
  FROM   program_applications pa
  JOIN   programs p ON p.id = pa.program_id
  JOIN   groups g ON g.id = pa.group_id
`;

const OPEN_STATUSES: ProgramApplicationStatus[] = [
  'draft',
  'submitted',
  'under_review',
  'additional_information_requested',
];

async function loadForUpdate(
  client: PoolClient,
  id: string,
): Promise<{ programId: string; groupId: string; status: ProgramApplicationStatus } | undefined> {
  const { rows } = await client.query<{ program_id: string; group_id: string; status: ProgramApplicationStatus }>(
    `SELECT program_id, group_id, status FROM program_applications WHERE id = $1 FOR UPDATE`,
    [id],
  );
  return rows[0] ? { programId: rows[0].program_id, groupId: rows[0].group_id, status: rows[0].status } : undefined;
}

export const programApplicationsService = {
  /** Chairperson applies their group to a published program. */
  async submitApplication(
    ctx: TenantContext,
    programId: string,
    applicationData: Record<string, unknown> = {},
  ): Promise<ProgramApplicationRow> {
    if (ctx.role !== 'chairperson') throw new ForbiddenError('Only the chairperson can submit a program application');
    if (!ctx.groupId) throw new ValidationError('Group context is required');

    // getProgram() 404s a non-published program for a non-org caller, so a
    // group can't apply to (or even detect) a draft/paused program.
    await programsService.getProgram(ctx, programId);

    try {
      return await withAdminDb(async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO program_applications (program_id, group_id, submitted_by, status, application_data)
           VALUES ($1, $2, $3, 'submitted', $4::jsonb)
           RETURNING id`,
          [programId, ctx.groupId, ctx.userId, JSON.stringify(applicationData)],
        );
        await client.query(
          `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id)
           VALUES ($1, 'programApplication.submit', 'program_application', $2)`,
          [ctx.userId, rows[0].id],
        );
        const { rows: full } = await client.query<ProgramApplicationRow>(`${ROW_SELECT} WHERE pa.id = $1`, [
          rows[0].id,
        ]);
        return full[0];
      });
    } catch (err) {
      if (
        err instanceof DatabaseError &&
        err.code === '23505' &&
        err.constraint === 'idx_program_applications_one_active'
      ) {
        throw new ConflictError('This group already has an active application for this program');
      }
      throw err;
    }
  },

  async listForProgram(ctx: TenantContext, programId: string): Promise<ProgramApplicationRow[]> {
    await programsService.assertOwnedByOrganization(ctx, programId);
    return withAdminDb(async (client) => {
      const { rows } = await client.query<ProgramApplicationRow>(
        `${ROW_SELECT} WHERE pa.program_id = $1 ORDER BY pa.created_at DESC`,
        [programId],
      );
      return rows;
    });
  },

  async listForGroup(ctx: TenantContext): Promise<ProgramApplicationRow[]> {
    if (!ctx.groupId) throw new ValidationError('Group context is required');
    return withDb(ctx, async (client) => {
      const { rows } = await client.query<ProgramApplicationRow>(
        `${ROW_SELECT} WHERE pa.group_id = $1 ORDER BY pa.created_at DESC`,
        [ctx.groupId],
      );
      return rows;
    });
  },

  async getApplication(ctx: TenantContext, id: string): Promise<ProgramApplicationRow> {
    const { rows } = await withDb(ctx, (client) =>
      client.query<ProgramApplicationRow>(`${ROW_SELECT} WHERE pa.id = $1`, [id]),
    );
    if (!rows[0]) throw new NotFoundError('Program application', id);
    return rows[0];
  },

  /** Org coordinator marks an application as actively being reviewed. */
  async markUnderReview(ctx: TenantContext, id: string): Promise<ProgramApplicationRow> {
    await organizationService.assertOrganizationCoordinator(ctx);
    return withAdminDb(async (client) => {
      const existing = await loadForUpdate(client, id);
      if (!existing) throw new NotFoundError('Program application', id);
      await programsService.assertOwnedByOrganization(ctx, existing.programId);
      if (!['submitted', 'additional_information_requested'].includes(existing.status)) {
        throw new ValidationError(`Cannot move an application from '${existing.status}' to 'under_review'`);
      }
      await client.query(`UPDATE program_applications SET status = 'under_review' WHERE id = $1`, [id]);
      const { rows } = await client.query<ProgramApplicationRow>(`${ROW_SELECT} WHERE pa.id = $1`, [id]);
      return rows[0];
    });
  },

  /** Org coordinator requests more information; the group may resubmit via submitApplication-equivalent data edits. */
  async requestMoreInfo(ctx: TenantContext, id: string, reviewNotes: string): Promise<ProgramApplicationRow> {
    if (!reviewNotes.trim()) throw new ValidationError('Review notes are required when requesting more information');
    await organizationService.assertOrganizationCoordinator(ctx);
    return withAdminDb(async (client) => {
      const existing = await loadForUpdate(client, id);
      if (!existing) throw new NotFoundError('Program application', id);
      await programsService.assertOwnedByOrganization(ctx, existing.programId);
      if (!['submitted', 'under_review'].includes(existing.status)) {
        throw new ValidationError(`Cannot request more information on an application in status '${existing.status}'`);
      }
      await client.query(
        `UPDATE program_applications
         SET    status = 'additional_information_requested', review_notes = $2, reviewed_by = $3, reviewed_at = NOW()
         WHERE  id = $1`,
        [id, reviewNotes, ctx.userId],
      );
      await client.query(
        `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, new_values)
         VALUES ($1, 'programApplication.requestMoreInfo', 'program_application', $2, jsonb_build_object('reviewNotes', $3::text))`,
        [ctx.userId, id, reviewNotes],
      );
      const { rows } = await client.query<ProgramApplicationRow>(`${ROW_SELECT} WHERE pa.id = $1`, [id]);
      return rows[0];
    });
  },

  /** Org coordinator accepts — idempotent, activates (or confirms) a program_memberships row. */
  async acceptApplication(
    ctx: TenantContext,
    id: string,
    reviewNotes?: string,
  ): Promise<{ application: ProgramApplicationRow; membership: ProgramMembershipRow }> {
    await organizationService.assertOrganizationCoordinator(ctx);
    return withAdminDb(async (client) => {
      const existing = await loadForUpdate(client, id);
      if (!existing) throw new NotFoundError('Program application', id);
      await programsService.assertOwnedByOrganization(ctx, existing.programId);

      if (existing.status !== 'accepted') {
        if (!OPEN_STATUSES.includes(existing.status)) {
          throw new ValidationError(`Cannot accept an application in status '${existing.status}'`);
        }
        await client.query(
          `UPDATE program_applications
           SET    status = 'accepted', review_notes = COALESCE($2, review_notes), reviewed_by = $3, reviewed_at = NOW()
           WHERE  id = $1`,
          [id, reviewNotes ?? null, ctx.userId],
        );
        await client.query(
          `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id)
           VALUES ($1, 'programApplication.accept', 'program_application', $2)`,
          [ctx.userId, id],
        );
      }

      const membership = await activateProgramMembership(client, existing.programId, existing.groupId, 'application');
      const { rows } = await client.query<ProgramApplicationRow>(`${ROW_SELECT} WHERE pa.id = $1`, [id]);
      return { application: rows[0], membership };
    });
  },

  /** Org coordinator declines, with a required reason. */
  async declineApplication(ctx: TenantContext, id: string, reviewNotes: string): Promise<ProgramApplicationRow> {
    if (!reviewNotes.trim()) throw new ValidationError('A reason is required to decline an application');
    await organizationService.assertOrganizationCoordinator(ctx);
    return withAdminDb(async (client) => {
      const existing = await loadForUpdate(client, id);
      if (!existing) throw new NotFoundError('Program application', id);
      await programsService.assertOwnedByOrganization(ctx, existing.programId);
      if (!OPEN_STATUSES.includes(existing.status)) {
        throw new ValidationError(`Cannot decline an application in status '${existing.status}'`);
      }
      await client.query(
        `UPDATE program_applications
         SET    status = 'declined', review_notes = $2, reviewed_by = $3, reviewed_at = NOW()
         WHERE  id = $1`,
        [id, reviewNotes, ctx.userId],
      );
      await client.query(
        `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, new_values)
         VALUES ($1, 'programApplication.decline', 'program_application', $2, jsonb_build_object('reviewNotes', $3::text))`,
        [ctx.userId, id, reviewNotes],
      );
      const { rows } = await client.query<ProgramApplicationRow>(`${ROW_SELECT} WHERE pa.id = $1`, [id]);
      return rows[0];
    });
  },

  /** Group chairperson withdraws their own group's still-open application. */
  async withdrawApplication(ctx: TenantContext, id: string): Promise<ProgramApplicationRow> {
    if (ctx.role !== 'chairperson') throw new ForbiddenError('Only the chairperson can withdraw a program application');
    if (!ctx.groupId) throw new ValidationError('Group context is required');
    return withAdminDb(async (client) => {
      const existing = await loadForUpdate(client, id);
      if (!existing) throw new NotFoundError('Program application', id);
      if (existing.groupId !== ctx.groupId) throw new NotFoundError('Program application', id);
      if (!OPEN_STATUSES.includes(existing.status)) {
        throw new ValidationError(`Cannot withdraw an application in status '${existing.status}'`);
      }
      await client.query(`UPDATE program_applications SET status = 'withdrawn' WHERE id = $1`, [id]);
      await client.query(
        `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id)
         VALUES ($1, 'programApplication.withdraw', 'program_application', $2)`,
        [ctx.userId, id],
      );
      const { rows } = await client.query<ProgramApplicationRow>(`${ROW_SELECT} WHERE pa.id = $1`, [id]);
      return rows[0];
    });
  },
};
