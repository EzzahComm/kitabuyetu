/**
 * Who may run a Changi$ha campaign, and who must sign off its withdrawals.
 *
 * A campaign belongs to a group, and releasing its money needs sign-off from
 * three different offices of that group (then Kitabu Yetu). So a group can only
 * run a campaign once it has an active chairperson, a treasurer and a
 * secretary. group_members holds one role per person per group
 * (UNIQUE (group_id, member_id)), so three filled offices means three
 * different people.
 */
import type { PoolClient } from 'pg';
import { AppError } from '@/lib/utils/errors';

type Queryable = Pick<PoolClient, 'query'>;

export const CAMPAIGN_OFFICER_ROLES = ['chairperson', 'treasurer', 'secretary'] as const;
export type CampaignOfficerRole = (typeof CAMPAIGN_OFFICER_ROLES)[number];

export interface CampaignOfficerHolder {
  memberId: string;
  name: string;
}

export interface CampaignOfficerStatus {
  /** All three offices have at least one active holder. */
  complete: boolean;
  officers: Record<CampaignOfficerRole, CampaignOfficerHolder[]>;
  missing: CampaignOfficerRole[];
}

export class CampaignOfficersIncompleteError extends AppError {
  constructor(public readonly missing: CampaignOfficerRole[]) {
    super(
      `A campaign needs an active chairperson, treasurer and secretary in the group. Still missing: ${missing.join(', ')}. ` +
        'Add them under Members first.',
      'CAMPAIGN_OFFICERS_INCOMPLETE',
      422,
    );
    this.name = 'CampaignOfficersIncompleteError';
  }
}

export function isCampaignOfficerRole(role: string | null | undefined): role is CampaignOfficerRole {
  return (CAMPAIGN_OFFICER_ROLES as readonly string[]).includes(role ?? '');
}

export async function getCampaignOfficerStatus(db: Queryable, groupId: string): Promise<CampaignOfficerStatus> {
  const { rows } = await db.query<{ role: CampaignOfficerRole; member_id: string; name: string }>(
    `SELECT gm.role::text AS role, gm.member_id, trim(m.first_name || ' ' || m.last_name) AS name
     FROM   group_members gm
     JOIN   members m ON m.id = gm.member_id
     WHERE  gm.group_id = $1
       AND  gm.status = 'active'
       AND  gm.role::text = ANY($2::text[])
     ORDER  BY gm.role::text, name`,
    [groupId, CAMPAIGN_OFFICER_ROLES as unknown as string[]],
  );

  const officers: Record<CampaignOfficerRole, CampaignOfficerHolder[]> = {
    chairperson: [],
    treasurer: [],
    secretary: [],
  };
  for (const row of rows) officers[row.role].push({ memberId: row.member_id, name: row.name });

  const missing = CAMPAIGN_OFFICER_ROLES.filter((role) => officers[role].length === 0);
  return { complete: missing.length === 0, officers, missing };
}

/** Throws CampaignOfficersIncompleteError unless the group has all three offices filled. */
export async function assertCampaignOfficersComplete(db: Queryable, groupId: string): Promise<void> {
  const status = await getCampaignOfficerStatus(db, groupId);
  if (!status.complete) throw new CampaignOfficersIncompleteError(status.missing);
}

/** The member's office in the group, or null if they are not an active chairperson/treasurer/secretary. */
export async function getOfficerRole(
  db: Queryable,
  groupId: string,
  memberId: string,
): Promise<CampaignOfficerRole | null> {
  const { rows } = await db.query<{ role: string }>(
    `SELECT role::text AS role FROM group_members
     WHERE  group_id = $1 AND member_id = $2 AND status = 'active'`,
    [groupId, memberId],
  );
  const role = rows[0]?.role;
  return isCampaignOfficerRole(role) ? role : null;
}

/** Offices that have already approved this withdrawal (officer decisions only, not the platform's). */
export async function getApprovedOfficerRoles(db: Queryable, subjectId: string): Promise<CampaignOfficerRole[]> {
  const { rows } = await db.query<{ approver_role: string | null }>(
    `SELECT DISTINCT approver_role FROM settlement_approvals
     WHERE  subject_type = 'campaign_withdrawal' AND subject_id = $1
       AND  approver_kind = 'officer' AND decision = 'approved'`,
    [subjectId],
  );
  return rows.map((r) => r.approver_role).filter(isCampaignOfficerRole);
}

/** Approved offices for several withdrawals at once, keyed by withdrawal id (one query, for list views). */
export async function getApprovedOfficerRolesBySubject(
  db: Queryable,
  subjectIds: string[],
): Promise<Map<string, CampaignOfficerRole[]>> {
  const bySubject = new Map<string, CampaignOfficerRole[]>();
  if (subjectIds.length === 0) return bySubject;
  const { rows } = await db.query<{ subject_id: string; approver_role: string | null }>(
    `SELECT subject_id, approver_role FROM settlement_approvals
     WHERE  subject_type = 'campaign_withdrawal' AND subject_id = ANY($1::uuid[])
       AND  approver_kind = 'officer' AND decision = 'approved'`,
    [subjectIds],
  );
  for (const row of rows) {
    if (!isCampaignOfficerRole(row.approver_role)) continue;
    const roles = bySubject.get(row.subject_id) ?? [];
    roles.push(row.approver_role);
    bySubject.set(row.subject_id, roles);
  }
  return bySubject;
}

/**
 * The offices that still have to approve: every office except the requester's,
 * minus those already approved. The requester's own office counts as their
 * sign-off, so the other two must each approve.
 */
export function remainingApproverRoles(
  requestedByRole: CampaignOfficerRole | null,
  approved: CampaignOfficerRole[],
): CampaignOfficerRole[] {
  return CAMPAIGN_OFFICER_ROLES.filter((role) => role !== requestedByRole && !approved.includes(role));
}
