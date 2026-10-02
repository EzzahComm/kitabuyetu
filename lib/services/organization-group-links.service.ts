/**
 * Group↔organization link requests, platform-admin approved.
 *
 * organization_group_access existed with a bare grant/revoke shape but no
 * application code ever wrote to it (migration 206 added the request/
 * approval lifecycle — status/requested_by/requested_at/reviewed_by/
 * reviewed_at/rejection_reason). Either side can request; platform admin
 * approval is the only gate, no counter-party consent required.
 *
 * Mirrors campaign-withdrawals.service.ts's platformApprove/platformReject
 * shape (row lock, status check in the WHERE clause, audit_logs row), but
 * without settlement_approvals — that ledger is specific to money flows;
 * this is a simpler non-financial decision, closer to how
 * ecosystem.service.ts's updateApplicationStatus works.
 */
import type { PoolClient } from 'pg';
import { withDb, withAdminDb, type TenantContext } from '@/lib/db';
import { organizationService } from './organization.service';
import { assertLinkedGroupCap } from './organization-plan.service';
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/utils/errors';
import { emitActivity, ActivityEventType } from '@/lib/notifications';

export interface OrgGroupLinkRow {
  id: string;
  organizationId: string;
  organizationName: string;
  groupId: string;
  groupName: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedBy: string;
  requestedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
}

const ROW_SELECT = `
  SELECT oga.id, oga.organization_id AS "organizationId", o.name AS "organizationName",
         oga.group_id AS "groupId", g.name AS "groupName",
         oga.status, oga.requested_by AS "requestedBy", oga.requested_at AS "requestedAt",
         oga.reviewed_by AS "reviewedBy", oga.reviewed_at AS "reviewedAt",
         oga.rejection_reason AS "rejectionReason"
  FROM   organization_group_access oga
  JOIN   organizations o ON o.id = oga.organization_id
  JOIN   groups g ON g.id = oga.group_id
`;

async function insertRequest(
  client: PoolClient,
  organizationId: string,
  groupId: string,
  requestedBy: string,
): Promise<OrgGroupLinkRow> {
  // Partial unique index (migration 206) rejects a duplicate pending/approved
  // pair with 23505 — the route layer maps that to a clear "already
  // requested" message rather than a generic 500.
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO organization_group_access (organization_id, group_id, requested_by, status, is_active)
     VALUES ($1, $2, $3, 'pending', false)
     RETURNING id`,
    [organizationId, groupId, requestedBy],
  );
  const { rows: full } = await client.query<OrgGroupLinkRow>(`${ROW_SELECT} WHERE oga.id = $1`, [rows[0].id]);
  const row = full[0];

  // Admin-surfacing alert — wrapped so a notification failure never blocks
  // the request itself (same tolerance as every other emitActivity call site).
  try {
    await emitActivity({
      type: ActivityEventType.ORG_GROUP_LINK_REQUESTED,
      dedupKey: `org-group-link-requested:${row.id}`,
      actor: { userId: requestedBy },
      group: { id: row.groupId, name: row.groupName },
      metadata: {
        organizationId: row.organizationId,
        organizationName: row.organizationName,
        smsLines: [`Organization: ${row.organizationName}`, `Group: ${row.groupName}`],
      },
    });
  } catch {
    // non-fatal
  }

  return row;
}

export const organizationGroupLinksService = {
  /** Chairperson requests their group be linked to an organization, found by name. */
  async requestLinkFromGroup(ctx: TenantContext, organizationName: string): Promise<OrgGroupLinkRow> {
    if (ctx.role !== 'chairperson') throw new ForbiddenError('Only the chairperson can request an organization link');
    if (!ctx.groupId) throw new ValidationError('Group context is required');

    return withAdminDb(async (client) => {
      const { rows: orgs } = await client.query<{ id: string }>(
        `SELECT id FROM organizations WHERE is_active = true AND name ILIKE $1 LIMIT 2`,
        [organizationName.trim()],
      );
      if (orgs.length === 0) throw new NotFoundError('Organization', organizationName);
      if (orgs.length > 1) {
        throw new ValidationError('More than one organization matches that name — contact support to link precisely');
      }
      return insertRequest(client, orgs[0].id, ctx.groupId!, ctx.userId);
    });
  },

  /** Organization coordinator requests a group be linked, found by its group code. */
  async requestLinkFromOrganization(ctx: TenantContext, groupCode: string): Promise<OrgGroupLinkRow> {
    await organizationService.assertOrganizationCoordinator(ctx);
    if (!ctx.organizationId) throw new ValidationError('Organization context is required');

    return withAdminDb(async (client) => {
      const { rows: groups } = await client.query<{ id: string }>(
        `SELECT id FROM groups WHERE is_active = true AND group_code = $1`,
        [groupCode.trim().toUpperCase()],
      );
      if (!groups[0]) throw new NotFoundError('Group', groupCode);
      return insertRequest(client, ctx.organizationId!, groups[0].id, ctx.userId);
    });
  },

  /** The calling group's own current link (any status), if one exists. */
  async getForGroup(ctx: TenantContext): Promise<OrgGroupLinkRow | null> {
    if (!ctx.groupId) throw new ValidationError('Group context is required');
    return withDb(ctx, async (client) => {
      const { rows } = await client.query<OrgGroupLinkRow>(
        `${ROW_SELECT} WHERE oga.group_id = $1 ORDER BY oga.requested_at DESC LIMIT 1`,
        [ctx.groupId],
      );
      return rows[0] ?? null;
    });
  },

  /** The calling organization's own links, every status. */
  async listForOrganization(ctx: TenantContext): Promise<OrgGroupLinkRow[]> {
    await organizationService.assertOrganizationCoordinator(ctx);
    if (!ctx.organizationId) throw new ValidationError('Organization context is required');
    return withDb(ctx, async (client) => {
      const { rows } = await client.query<OrgGroupLinkRow>(
        `${ROW_SELECT} WHERE oga.organization_id = $1 ORDER BY oga.requested_at DESC`,
        [ctx.organizationId],
      );
      return rows;
    });
  },

  /** Platform admin: every link awaiting review. */
  async listPendingRequests(): Promise<OrgGroupLinkRow[]> {
    return withAdminDb(async (client) => {
      const { rows } = await client.query<OrgGroupLinkRow>(`${ROW_SELECT} WHERE oga.status = 'pending' ORDER BY oga.requested_at ASC`);
      return rows;
    });
  },

  /** Platform admin approves: enforces the organization's plan-tier linked-group cap, flips the row live. */
  async approveLink(adminUserId: string, id: string): Promise<OrgGroupLinkRow> {
    return withAdminDb(async (client) => {
      const { rows } = await client.query<{ organization_id: string; group_id: string }>(
        `SELECT organization_id, group_id FROM organization_group_access WHERE id = $1 AND status = 'pending' FOR UPDATE`,
        [id],
      );
      if (!rows[0]) throw new NotFoundError('Pending organization-group link', id);
      const { organization_id, group_id } = rows[0];

      await assertLinkedGroupCap(client, organization_id, group_id);

      await client.query(
        `UPDATE organization_group_access
         SET    status = 'approved', is_active = true, granted_by = $2, granted_at = NOW(),
                reviewed_by = $2, reviewed_at = NOW()
         WHERE  id = $1`,
        [id, adminUserId],
      );
      await client.query(
        `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, new_values)
         VALUES ($1, 'organizationGroupLink.approve', 'organization_group_access', $2, jsonb_build_object('organizationId', $3::uuid, 'groupId', $4::uuid))`,
        [adminUserId, id, organization_id, group_id],
      );

      const { rows: full } = await client.query<OrgGroupLinkRow>(`${ROW_SELECT} WHERE oga.id = $1`, [id]);
      const row = full[0];
      try {
        await emitActivity({
          type: ActivityEventType.ORG_GROUP_LINK_APPROVED,
          dedupKey: `org-group-link-approved:${id}`,
          actor: { userId: adminUserId, role: 'super_admin' },
          group: { id: row.groupId, name: row.groupName },
          metadata: { organizationId: row.organizationId, organizationName: row.organizationName },
        });
      } catch {
        // non-fatal
      }
      return row;
    });
  },

  /** Platform admin rejects, with a required reason. The row stays for history; a fresh request is a new row. */
  async rejectLink(adminUserId: string, id: string, reason: string): Promise<OrgGroupLinkRow> {
    if (!reason.trim()) throw new ValidationError('A reason is required to reject a link request');
    return withAdminDb(async (client) => {
      const { rows } = await client.query<{ organization_id: string; group_id: string }>(
        `SELECT organization_id, group_id FROM organization_group_access WHERE id = $1 AND status = 'pending' FOR UPDATE`,
        [id],
      );
      if (!rows[0]) throw new NotFoundError('Pending organization-group link', id);

      await client.query(
        `UPDATE organization_group_access
         SET    status = 'rejected', reviewed_by = $2, reviewed_at = NOW(), rejection_reason = $3
         WHERE  id = $1`,
        [id, adminUserId, reason],
      );
      await client.query(
        `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, new_values)
         VALUES ($1, 'organizationGroupLink.reject', 'organization_group_access', $2, jsonb_build_object('reason', $3::text))`,
        [adminUserId, id, reason],
      );

      const { rows: full } = await client.query<OrgGroupLinkRow>(`${ROW_SELECT} WHERE oga.id = $1`, [id]);
      const row = full[0];
      try {
        await emitActivity({
          type: ActivityEventType.ORG_GROUP_LINK_REJECTED,
          dedupKey: `org-group-link-rejected:${id}`,
          actor: { userId: adminUserId, role: 'super_admin' },
          group: { id: row.groupId, name: row.groupName },
          metadata: { organizationId: row.organizationId, organizationName: row.organizationName, reason },
        });
      } catch {
        // non-fatal
      }
      return row;
    });
  },
};
