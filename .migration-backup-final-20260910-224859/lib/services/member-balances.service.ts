/**
 * Shared per-member financial snapshot (savings/shares/loan balance/this-
 * period contributions) — extracted from statement-email.service.ts's
 * sendMemberStatements(), which had this exact calculation inlined. Now
 * reused by the (member) portal's own wallet endpoint
 * (member-wallet.service.ts) so the two never drift apart — this codebase
 * has a documented history of bugs from duplicated calculation/posting
 * logic (see docs/audits/ACCOUNTING_ARCHITECTURE_AUDIT.md).
 *
 * Client-agnostic: callers pass whichever pool client they already hold
 * (withAdminDb for the bulk email job, withDb for the self-service route).
 */
import type { PoolClient } from 'pg';

export interface MemberFinancialSnapshot {
  memberId:              string;
  savings:                number;
  loanBalance:            number;
  shares:                 number;
  contributedThisPeriod:  number;
}

interface SnapshotRow {
  member_id:               string;
  savings:                 string;
  loan_balance:            string;
  shares:                  string;
  contributed_this_period: string;
}

/**
 * One row per active member of `groupId`, or a single row when `memberId`
 * is given. Missing balances (a member with no contributions/loans/shares)
 * come back as 0, not omitted.
 */
export async function computeMemberFinancialSnapshot(
  client: PoolClient,
  groupId: string,
  memberId?: string,
): Promise<MemberFinancialSnapshot[]> {
  const { rows } = await client.query<SnapshotRow>(
    `SELECT gm.member_id,
            COALESCE(sav.total, 0)::text AS savings,
            COALESCE(ln.total, 0)::text  AS loan_balance,
            COALESCE(shr.total, 0)::text AS shares,
            COALESCE(per.total, 0)::text AS contributed_this_period
     FROM group_members gm
     LEFT JOIN (
       SELECT member_id, SUM(amount) AS total FROM contributions
       WHERE group_id = $1 AND status = 'completed'
       GROUP BY member_id
     ) sav ON sav.member_id = gm.member_id
     LEFT JOIN (
       SELECT member_id, SUM(outstanding_balance) AS total FROM loans
       WHERE group_id = $1 AND status IN ('active', 'disbursed')
       GROUP BY member_id
     ) ln ON ln.member_id = gm.member_id
     LEFT JOIN (
       SELECT sh.member_id, SUM(sh.quantity * COALESCE(sc.current_value, sc.par_value)) AS total
       FROM share_holdings sh JOIN share_classes sc ON sc.id = sh.share_class_id
       WHERE sh.group_id = $1
       GROUP BY sh.member_id
     ) shr ON shr.member_id = gm.member_id
     LEFT JOIN (
       SELECT member_id, SUM(amount) AS total FROM contributions
       WHERE group_id = $1 AND status = 'completed'
         AND DATE_TRUNC('month', contribution_date) = DATE_TRUNC('month', CURRENT_DATE)
       GROUP BY member_id
     ) per ON per.member_id = gm.member_id
     WHERE gm.group_id = $1 AND gm.status = 'active'
       AND ($2::uuid IS NULL OR gm.member_id = $2)`,
    [groupId, memberId ?? null],
  );

  return rows.map((r) => ({
    memberId:              r.member_id,
    savings:                parseFloat(r.savings),
    loanBalance:            parseFloat(r.loan_balance),
    shares:                 parseFloat(r.shares),
    contributedThisPeriod:  parseFloat(r.contributed_this_period),
  }));
}
