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
  memberId: string;
  /** Completed contributions net of completed savings withdrawals (migration 218). */
  savings: number;
  loanBalance: number;
  shares: number;
  contributedThisPeriod: number;
}

interface SnapshotRow {
  member_id: string;
  savings: string;
  loan_balance: string;
  shares: string;
  contributed_this_period: string;
}

/**
 * Disbursement states that still hold (or already spent) a member's money:
 * a savings withdrawal in any of these counts against what they can withdraw
 * next. timed_out is included deliberately — its true outcome is unknown
 * until a human reconciles it, so it must not be paid twice.
 */
export const WITHDRAWAL_COMMITTED_STATUSES = [
  'pending_approval',
  'awaiting_platform',
  'approved',
  'dispatched',
  'completed',
  'timed_out',
];

export interface MemberPayoutRecipient {
  memberId: string;
  groupMembershipId: string;
  /** Registered phone — the only number a payout may go to. */
  phone: string | null;
  fullName: string;
  /** Completed contributions − committed savings withdrawals. */
  withdrawableSavings: number;
}

/**
 * Resolves a payout recipient (active member of the group, registered phone)
 * and their withdrawable savings. The caller must already hold the group's
 * cash-account lock (lock_group_cash_account) when it uses the result to gate
 * a withdrawal — that lock serializes every disbursement in the group, so two
 * concurrent withdrawals can't both pass this check against the same savings.
 */
export async function resolveMemberPayoutRecipient(
  client: PoolClient,
  groupId: string,
  memberId: string,
): Promise<MemberPayoutRecipient | null> {
  const { rows } = await client.query<{
    member_id: string;
    group_membership_id: string;
    phone: string | null;
    full_name: string;
    contributed: string;
    withdrawn: string;
  }>(
    `SELECT gm.member_id, gm.id AS group_membership_id, m.phone,
            TRIM(m.first_name || ' ' || COALESCE(m.last_name, '')) AS full_name,
            COALESCE((SELECT SUM(c.amount) FROM contributions c
                      WHERE c.group_id = $1 AND c.member_id = gm.member_id AND c.status = 'completed'), 0)::text
              AS contributed,
            COALESCE((SELECT SUM(dr.amount) FROM disbursement_requests dr
                      WHERE dr.group_id = $1 AND dr.member_id = gm.member_id
                        AND dr.payout_purpose = 'savings_withdrawal'
                        AND dr.status::text = ANY($3)), 0)::text
              AS withdrawn
     FROM   group_members gm
     JOIN   members m ON m.id = gm.member_id
     WHERE  gm.group_id = $1 AND gm.member_id = $2 AND gm.status = 'active'`,
    [groupId, memberId, WITHDRAWAL_COMMITTED_STATUSES],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    memberId: r.member_id,
    groupMembershipId: r.group_membership_id,
    phone: r.phone,
    fullName: r.full_name,
    withdrawableSavings: Math.max(0, parseFloat(r.contributed) - parseFloat(r.withdrawn)),
  };
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
            (COALESCE(sav.total, 0) - COALESCE(wd.total, 0))::text AS savings,
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
       -- Savings withdrawals paid out over B2C (migration 218) — the member
       -- side of the member_payout journal. Only money that actually left.
       SELECT member_id, SUM(amount) AS total FROM disbursement_requests
       WHERE group_id = $1 AND payout_purpose = 'savings_withdrawal' AND status = 'completed'
       GROUP BY member_id
     ) wd ON wd.member_id = gm.member_id
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
    memberId: r.member_id,
    savings: parseFloat(r.savings),
    loanBalance: parseFloat(r.loan_balance),
    shares: parseFloat(r.shares),
    contributedThisPeriod: parseFloat(r.contributed_this_period),
  }));
}
