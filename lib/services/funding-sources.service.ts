/**
 * Group funding sources (migration 115) — provenance of a group's capital.
 *
 * First service of the Capital & Investment Layer
 * (docs/capital-layer/capital-layer-spec.md). This is a classification table,
 * not a ledger: it records WHERE a group's money came from so that member loans
 * can later be attributed to a source via loan_funding_splits. It holds no
 * balances and moves no money.
 *
 * Every query explicitly scopes by group_id rather than relying on RLS alone
 * (ADR-001: RLS is still decorative for application traffic pending the
 * app_tenant cutover — see docs/capital-layer/impact-report.md §D-D).
 */
import { withDb, type TenantContext } from '@/lib/db';
import { NotFoundError } from '@/lib/utils/errors';

export type FundingSourceType =
  | 'internal_savings'
  | 'organization_allocation'
  | 'external_grant'
  | 'bank_loan'
  | 'other';

export interface GroupFundingSource {
  id:             string;
  groupId:        string;
  sourceType:     FundingSourceType;
  allocationId:   string | null;
  organizationId: string | null;
  /** Organization's display name, present only for allocation-backed sources. */
  organizationName: string | null;
  label:          string;
  isRepayable:    boolean;
  status:         'active' | 'closed';
  openedAt:       Date;
  closedAt:       Date | null;
}

interface FundingSourceRow {
  id: string;
  group_id: string;
  source_type: FundingSourceType;
  allocation_id: string | null;
  organization_id: string | null;
  organization_name: string | null;
  label: string;
  is_repayable: boolean;
  status: 'active' | 'closed';
  opened_at: Date;
  closed_at: Date | null;
}

function mapRow(r: FundingSourceRow): GroupFundingSource {
  return {
    id:               r.id,
    groupId:          r.group_id,
    sourceType:       r.source_type,
    allocationId:     r.allocation_id,
    organizationId:   r.organization_id,
    organizationName: r.organization_name,
    label:            r.label,
    isRepayable:      r.is_repayable,
    status:           r.status,
    openedAt:         r.opened_at,
    closedAt:         r.closed_at,
  };
}

const SELECT_COLUMNS = `
  s.id, s.group_id, s.source_type, s.allocation_id, s.organization_id,
  o.name AS organization_name,
  s.label, s.is_repayable, s.status, s.opened_at, s.closed_at
`;

/**
 * All funding sources for the caller's group, internal savings first (it is the
 * default funding source for a member loan), then most recently opened.
 */
export async function listForGroup(ctx: TenantContext): Promise<GroupFundingSource[]> {
  return withDb(ctx, async (client) => {
    const { rows } = await client.query<FundingSourceRow>(
      `SELECT ${SELECT_COLUMNS}
       FROM group_funding_sources s
       LEFT JOIN organizations o ON o.id = s.organization_id
       WHERE s.group_id = $1
       ORDER BY (s.source_type = 'internal_savings') DESC,
                (s.status = 'active') DESC,
                s.opened_at DESC`,
      [ctx.groupId],
    );
    return rows.map(mapRow);
  });
}

/**
 * The group's internal savings source — guaranteed to exist by migration 115's
 * auto-provisioning trigger plus its backfill, for every group ever created.
 *
 * This is the default funding source when a member loan is disbursed without an
 * explicit funding plan, which is what keeps existing loan behaviour unchanged
 * once loan_funding_splits lands (capital-layer-spec.md §4).
 */
export async function getInternalSavingsSource(ctx: TenantContext): Promise<GroupFundingSource> {
  return withDb(ctx, async (client) => {
    const { rows } = await client.query<FundingSourceRow>(
      `SELECT ${SELECT_COLUMNS}
       FROM group_funding_sources s
       LEFT JOIN organizations o ON o.id = s.organization_id
       WHERE s.group_id = $1 AND s.source_type = 'internal_savings'`,
      [ctx.groupId],
    );

    if (rows.length === 0) {
      // Migration 115 guarantees this row exists and asserts it at apply time,
      // so reaching here means the trigger was dropped or the group was created
      // by a path that bypassed it — a real data-integrity fault, not a
      // not-found the caller should paper over.
      throw new NotFoundError('Group has no internal savings funding source');
    }

    return mapRow(rows[0]);
  });
}
