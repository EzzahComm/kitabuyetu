/**
 * The (member) portal's own wallet summary — savings/shares/loan balance
 * reuse the shared computeMemberFinancialSnapshot() (member-balances.service.ts,
 * also used by statement-email.service.ts) rather than recomputing the same
 * SQL a third time. The "next payment due" nudge card needs a second,
 * member-only query loans/loan_repayments don't share with the snapshot.
 */
import type { PoolClient } from 'pg';
import { withDb, type TenantContext } from '@/lib/db';
import { computeMemberFinancialSnapshot } from './member-balances.service';
import { formatDate } from '@/lib/utils';

export interface ActiveLoanSummary {
  loanId:       string;
  balance:      number;
  principal:    number;
  nextAmount:   number;
  nextDueLabel: string;
  progress:     number; // 0-100, share of total_repayable already paid down
}

export interface MemberWalletSummary {
  savings:     number;
  shares:      number;
  thisMonth:   number;
  loanBalance: number;
  activeLoan:  ActiveLoanSummary | null;
}

interface ActiveLoanRow {
  id:                  string;
  principal_amount:    string;
  total_repayable:     string | null;
  outstanding_balance: string | null;
}

interface NextInstallmentRow {
  total_due: string;
  due_date:  string;
}

async function loadActiveLoan(client: PoolClient, ctx: TenantContext): Promise<ActiveLoanSummary | null> {
  const { rows } = await client.query<ActiveLoanRow>(
    `SELECT id, principal_amount, total_repayable, outstanding_balance
     FROM loans
     WHERE group_id = $1 AND member_id = $2 AND status IN ('active', 'disbursed')
     ORDER BY disbursement_date DESC NULLS LAST
     LIMIT 1`,
    [ctx.groupId, ctx.userId],
  );
  const loan = rows[0];
  if (!loan) return null;

  const { rows: nextRows } = await client.query<NextInstallmentRow>(
    `SELECT total_due, due_date::text FROM loan_repayments
     WHERE loan_id = $1 AND status = 'pending'
     ORDER BY installment_number ASC
     LIMIT 1`,
    [loan.id],
  );
  const next = nextRows[0];

  const totalRepayable = parseFloat(loan.total_repayable ?? '0');
  const outstanding    = parseFloat(loan.outstanding_balance ?? '0');

  return {
    loanId:       loan.id,
    balance:      outstanding,
    principal:    parseFloat(loan.principal_amount),
    nextAmount:   next ? parseFloat(next.total_due) : 0,
    nextDueLabel: next ? formatDate(next.due_date) : '—',
    progress:     totalRepayable > 0 ? Math.round((1 - outstanding / totalRepayable) * 100) : 0,
  };
}

export async function getMyWalletSummary(ctx: TenantContext): Promise<MemberWalletSummary> {
  return withDb(ctx, async (client) => {
    const [snapshot] = await computeMemberFinancialSnapshot(client, ctx.groupId, ctx.userId);
    const activeLoan = await loadActiveLoan(client, ctx);

    return {
      savings:     snapshot?.savings ?? 0,
      shares:      snapshot?.shares ?? 0,
      thisMonth:   snapshot?.contributedThisPeriod ?? 0,
      loanBalance: snapshot?.loanBalance ?? 0,
      activeLoan,
    };
  });
}
