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
import type { PoolClient } from 'pg';
import { withDb, type TenantContext } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/utils/errors';

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

export interface FundingSplit {
  fundingSourceId: string;
  amount:          number;
}

/**
 * Resolves the funding plan for a loan about to be disbursed, and validates it
 * against the group's real sources. Runs on the caller's transaction client so
 * it shares the disbursement's atomicity.
 *
 * With no plan supplied, the loan is funded entirely from the group's internal
 * savings. That default is what keeps every pre-existing caller working
 * unchanged once attribution becomes mandatory — a group that has never taken
 * organization capital should not have to think about this at all.
 *
 * Validated here rather than relying solely on migration 118's deferred
 * constraint trigger, so a bad plan produces a clear message instead of a raw
 * 23514 surfacing from commit time.
 */
export async function resolveFundingPlan(
  db: PoolClient,
  groupId: string,
  principal: number,
  plan?: FundingSplit[],
): Promise<FundingSplit[]> {
  if (!plan || plan.length === 0) {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM group_funding_sources
       WHERE group_id = $1 AND source_type = 'internal_savings'`,
      [groupId],
    );
    if (!rows[0]) {
      // Guaranteed to exist by migration 115's trigger + backfill, so this
      // means the trigger was dropped or the group was created by a path that
      // bypassed it — a data-integrity fault, not a user error.
      throw new NotFoundError('Group has no internal savings funding source');
    }
    return [{ fundingSourceId: rows[0].id, amount: principal }];
  }

  const total = plan.reduce((sum, p) => sum + p.amount, 0);
  // Compare in cents: 0.1 + 0.2 !== 0.3 in binary floating point, and money
  // here is numeric(15,2), so two decimal places is the real precision.
  if (Math.round(total * 100) !== Math.round(principal * 100)) {
    throw new ValidationError(
      `Funding plan totals ${total.toFixed(2)} but the loan principal is ${principal.toFixed(2)} — every disbursed loan must be fully attributed`,
    );
  }

  const { rows: valid } = await db.query<{ id: string; status: string; label: string }>(
    `SELECT id, status, label FROM group_funding_sources
     WHERE group_id = $1 AND id = ANY($2::uuid[])`,
    [groupId, plan.map((p) => p.fundingSourceId)],
  );

  if (valid.length !== plan.length) {
    throw new ValidationError('Funding plan references a source that does not belong to this group');
  }
  const closed = valid.find((s) => s.status !== 'active');
  if (closed) {
    throw new ValidationError(`Funding source "${closed.label}" is closed and cannot finance a new loan`);
  }

  return plan;
}

/** Reads back how a loan was funded — the attribution the capital layer rests on. */
export async function getLoanFundingSplits(
  ctx: TenantContext, loanId: string,
): Promise<(FundingSplit & { label: string; sourceType: FundingSourceType })[]> {
  return withDb(ctx, async (client) => {
    const { rows } = await client.query<{
      funding_source_id: string; amount: string; label: string; source_type: FundingSourceType;
    }>(
      `SELECT f.funding_source_id, f.amount, s.label, s.source_type
       FROM loan_funding_splits f
       JOIN group_funding_sources s ON s.id = f.funding_source_id
       WHERE f.loan_id = $1 AND f.group_id = $2
       ORDER BY f.amount DESC`,
      [loanId, ctx.groupId],
    );
    return rows.map((r) => ({
      fundingSourceId: r.funding_source_id,
      amount:          parseFloat(r.amount),
      label:           r.label,
      sourceType:      r.source_type,
    }));
  });
}
