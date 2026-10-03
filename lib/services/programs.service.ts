/**
 * Programs - organization-run initiatives groups apply to or are invited
 * into. Completely separate from funding_programs (budget/disbursement
 * config) and organizationFinanceService - see migration 206's header for
 * why these are two unrelated concepts that happen to share a name.
 *
 * This file is program CRUD + lifecycle only. Applications are
 * program-applications.service.ts; invitations are
 * program-invitations.service.ts; both create program_memberships rows on
 * acceptance.
 */
import type { PoolClient } from 'pg';
import { withDb, withAdminDb, type TenantContext } from '@/lib/db';
import { organizationService } from './organization.service';
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/utils/errors';

export type ProgramStatus = 'draft' | 'published' | 'paused' | 'closed' | 'archived';

export interface ProgramRow {
  id: string;
  organizationId: string;
  organizationName: string;
  name: string;
  slug: string;
  description: string | null;
  objectives: string | null;
  targetBeneficiaries: string | null;
  eligibilityCriteria: Record<string, unknown>;
  geographicCoverage: unknown[];
  applicationRequirements: string | null;
  status: ProgramStatus;
  startsOn: string | null;
  endsOn: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

const ROW_SELECT = `
  SELECT p.id, p.organization_id AS "organizationId", o.name AS "organizationName", p.name, p.slug,
         p.description, p.objectives, p.target_beneficiaries AS "targetBeneficiaries",
         p.eligibility_criteria AS "eligibilityCriteria", p.geographic_coverage AS "geographicCoverage",
         p.application_requirements AS "applicationRequirements", p.status,
         p.starts_on AS "startsOn", p.ends_on AS "endsOn",
         p.created_by AS "createdBy", p.created_at AS "createdAt", p.updated_at AS "updatedAt"
  FROM   programs p
  JOIN   organizations o ON o.id = p.organization_id
`;

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'program'
  );
}

export interface CreateProgramInput {
  name: string;
  description?: string;
  objectives?: string;
  targetBeneficiaries?: string;
  eligibilityCriteria?: Record<string, unknown>;
  geographicCoverage?: unknown[];
  applicationRequirements?: string;
  startsOn?: string;
  endsOn?: string;
}

const LIFECYCLE: Record<ProgramStatus, ProgramStatus[]> = {
  draft: ['published', 'archived'],
  published: ['paused', 'closed'],
  paused: ['published', 'closed'],
  closed: ['archived'],
  archived: [],
};

export type ProgramMembershipStatus = 'invited' | 'active' | 'suspended' | 'withdrawn' | 'completed' | 'removed';
export type ProgramMembershipSource = 'application' | 'invitation';

export interface ProgramMembershipRow {
  id: string;
  programId: string;
  groupId: string;
  status: ProgramMembershipStatus;
  source: ProgramMembershipSource;
  joinedAt: string;
  acceptedAt: string | null;
  leftAt: string | null;
}

const MEMBERSHIP_SELECT = `
  SELECT id, program_id AS "programId", group_id AS "groupId", status, source,
         joined_at AS "joinedAt", accepted_at AS "acceptedAt", left_at AS "leftAt"
  FROM   program_memberships
`;

/**
 * Called when an application is accepted or an invitation is accepted.
 * Idempotent: an already-active membership is returned as-is rather than
 * erroring, since both acceptance paths can legitimately be retried (e.g.
 * the route layer's own retry-on-timeout) without side effects.
 */
export async function activateProgramMembership(
  client: PoolClient,
  programId: string,
  groupId: string,
  source: ProgramMembershipSource,
): Promise<ProgramMembershipRow> {
  const { rows: existing } = await client.query<{ id: string; status: ProgramMembershipStatus }>(
    `SELECT id, status FROM program_memberships
     WHERE program_id = $1 AND group_id = $2 AND status IN ('invited', 'active')
     FOR UPDATE`,
    [programId, groupId],
  );

  let id: string;
  if (existing[0]?.status === 'active') {
    id = existing[0].id;
  } else if (existing[0]) {
    id = existing[0].id;
    await client.query(`UPDATE program_memberships SET status = 'active', accepted_at = NOW() WHERE id = $1`, [id]);
  } else {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO program_memberships (program_id, group_id, status, source, accepted_at)
       VALUES ($1, $2, 'active', $3, NOW())
       RETURNING id`,
      [programId, groupId, source],
    );
    id = rows[0].id;
  }

  const { rows: full } = await client.query<ProgramMembershipRow>(`${MEMBERSHIP_SELECT} WHERE id = $1`, [id]);
  return full[0];
}

export const programMembershipsService = {
  async listForProgram(ctx: TenantContext, programId: string): Promise<ProgramMembershipRow[]> {
    await programsService.assertOwnedByOrganization(ctx, programId);
    return withAdminDb(async (client) => {
      const { rows } = await client.query<ProgramMembershipRow>(
        `${MEMBERSHIP_SELECT} WHERE program_id = $1 ORDER BY joined_at DESC`,
        [programId],
      );
      return rows;
    });
  },

  async listForGroup(ctx: TenantContext): Promise<ProgramMembershipRow[]> {
    if (!ctx.groupId) throw new ValidationError('Group context is required');
    return withDb(ctx, async (client) => {
      const { rows } = await client.query<ProgramMembershipRow>(
        `${MEMBERSHIP_SELECT} WHERE group_id = $1 ORDER BY joined_at DESC`,
        [ctx.groupId],
      );
      return rows;
    });
  },
};

export const programsService = {
  async createProgram(ctx: TenantContext, input: CreateProgramInput): Promise<ProgramRow> {
    await organizationService.assertOrganizationCoordinator(ctx);
    if (!ctx.organizationId) throw new ForbiddenError('Organization context is required');
    if (!input.name || input.name.trim().length < 3) {
      throw new ValidationError('Program name must be at least 3 characters');
    }

    return withAdminDb(async (client) => {
      // Unique slug: base-2, base-3, ... on collision. Collisions are rare
      // (cross-organization slug space) so a short bounded loop is simpler
      // than a single clever query, matching register_group's KY-code
      // allocation style of "just retry on the rare collision" elsewhere.
      const base = slugify(input.name);
      let slug = base;
      for (let n = 2; n <= 50; n++) {
        const { rows } = await client.query<{ exists: boolean }>(
          `SELECT EXISTS(SELECT 1 FROM programs WHERE slug = $1)`,
          [slug],
        );
        if (!rows[0].exists) break;
        slug = `${base}-${n}`;
      }

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO programs (
           organization_id, name, slug, description, objectives, target_beneficiaries,
           eligibility_criteria, geographic_coverage, application_requirements,
           starts_on, ends_on, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12)
         RETURNING id`,
        [
          ctx.organizationId,
          input.name.trim(),
          slug,
          input.description ?? null,
          input.objectives ?? null,
          input.targetBeneficiaries ?? null,
          JSON.stringify(input.eligibilityCriteria ?? {}),
          JSON.stringify(input.geographicCoverage ?? []),
          input.applicationRequirements ?? null,
          input.startsOn ?? null,
          input.endsOn ?? null,
          ctx.userId,
        ],
      );
      await client.query(
        `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, new_values)
         VALUES ($1, 'program.create', 'program', $2, jsonb_build_object('name', $3::text))`,
        [ctx.userId, rows[0].id, input.name],
      );
      const { rows: full } = await client.query<ProgramRow>(`${ROW_SELECT} WHERE p.id = $1`, [rows[0].id]);
      return full[0];
    });
  },

  async updateProgram(
    ctx: TenantContext,
    id: string,
    input: Partial<Omit<CreateProgramInput, 'name'>> & { name?: string },
  ): Promise<ProgramRow> {
    await organizationService.assertOrganizationCoordinator(ctx);
    const existing = await this.getProgram(ctx, id);

    const fields: Record<string, unknown> = {};
    if (input.name !== undefined) fields.name = input.name.trim();
    if (input.description !== undefined) fields.description = input.description;
    if (input.objectives !== undefined) fields.objectives = input.objectives;
    if (input.targetBeneficiaries !== undefined) fields.target_beneficiaries = input.targetBeneficiaries;
    if (input.eligibilityCriteria !== undefined)
      fields.eligibility_criteria = JSON.stringify(input.eligibilityCriteria);
    if (input.geographicCoverage !== undefined) fields.geographic_coverage = JSON.stringify(input.geographicCoverage);
    if (input.applicationRequirements !== undefined) fields.application_requirements = input.applicationRequirements;
    if (input.startsOn !== undefined) fields.starts_on = input.startsOn;
    if (input.endsOn !== undefined) fields.ends_on = input.endsOn;

    const keys = Object.keys(fields);
    if (keys.length === 0) return existing;

    return withAdminDb(async (client) => {
      const setClause = keys
        .map(
          (k, i) => `${k} = $${i + 2}${k === 'eligibility_criteria' || k === 'geographic_coverage' ? '::jsonb' : ''}`,
        )
        .join(', ');
      await client.query(`UPDATE programs SET ${setClause} WHERE id = $1`, [id, ...keys.map((k) => fields[k])]);
      const { rows } = await client.query<ProgramRow>(`${ROW_SELECT} WHERE p.id = $1`, [id]);
      return rows[0];
    });
  },

  async transitionStatus(ctx: TenantContext, id: string, to: ProgramStatus): Promise<ProgramRow> {
    await organizationService.assertOrganizationCoordinator(ctx);
    const existing = await this.getProgram(ctx, id);
    if (!LIFECYCLE[existing.status].includes(to)) {
      throw new ValidationError(`Cannot move a program from '${existing.status}' to '${to}'`);
    }
    return withAdminDb(async (client) => {
      await client.query(`UPDATE programs SET status = $2 WHERE id = $1`, [id, to]);
      await client.query(
        `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, old_values, new_values)
         VALUES ($1, 'program.status_change', 'program', $2, jsonb_build_object('status', $3::text), jsonb_build_object('status', $4::text))`,
        [ctx.userId, id, existing.status, to],
      );
      const { rows } = await client.query<ProgramRow>(`${ROW_SELECT} WHERE p.id = $1`, [id]);
      return rows[0];
    });
  },

  async listPrograms(ctx: TenantContext): Promise<ProgramRow[]> {
    await organizationService.assertOrganizationCoordinator(ctx);
    if (!ctx.organizationId) throw new ForbiddenError('Organization context is required');
    return withDb(ctx, async (client) => {
      const { rows } = await client.query<ProgramRow>(
        `${ROW_SELECT} WHERE p.organization_id = $1 ORDER BY p.created_at DESC`,
        [ctx.organizationId],
      );
      return rows;
    });
  },

  /**
   * Published programs, discoverable by any group - group-side browse.
   * Uses withAdminDb rather than withDb: organizations_select's RLS policy
   * only admits super_admin or the owning organization_coordinator, so a
   * plain tenant role joining to `organizations` under RLS would get every
   * row filtered out and see an empty list. The `programs` row itself is
   * still hard-filtered to status = 'published' here, which is exactly what
   * programs_select's own RLS policy already grants any tenant role anyway -
   * this only fixes the join's visibility, it doesn't widen program access.
   */
  async listPublished(_ctx: TenantContext): Promise<ProgramRow[]> {
    return withAdminDb(async (client) => {
      const { rows } = await client.query<ProgramRow>(
        `${ROW_SELECT} WHERE p.status = 'published' ORDER BY p.created_at DESC`,
      );
      return rows;
    });
  },

  /**
   * withAdminDb for the same organizations-join reason as listPublished
   * above - so the authorization that RLS would otherwise provide is done
   * explicitly here instead: published rows are visible to anyone, a
   * non-published row only to super_admin or the row's OWN organization's
   * coordinator (checked by organizationId, not just role - a different
   * org's coordinator must not see this org's draft programs).
   */
  async getProgram(ctx: TenantContext, id: string): Promise<ProgramRow> {
    const { rows } = await withAdminDb((client) => client.query<ProgramRow>(`${ROW_SELECT} WHERE p.id = $1`, [id]));
    if (!rows[0]) throw new NotFoundError('Program', id);
    const row = rows[0];
    if (row.status !== 'published') {
      const isOwningCoordinator = ctx.role === 'organization_coordinator' && row.organizationId === ctx.organizationId;
      if (ctx.role !== 'super_admin' && !isOwningCoordinator) {
        throw new NotFoundError('Program', id);
      }
    }
    return row;
  },

  async assertOwnedByOrganization(ctx: TenantContext, programId: string): Promise<void> {
    if (ctx.role === 'super_admin') return;
    if (!ctx.organizationId) throw new ForbiddenError('Organization context is required');
    const { rows } = await withAdminDb((client) =>
      client.query<{ organization_id: string }>(`SELECT organization_id FROM programs WHERE id = $1`, [programId]),
    );
    if (!rows[0] || rows[0].organization_id !== ctx.organizationId) {
      throw new NotFoundError('Program', programId);
    }
  },
};
