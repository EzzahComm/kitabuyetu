import { withDb, type TenantContext } from '@/lib/db';
import { accountingService } from './accounting.service';

export const reportsService = {

  async contributionSummary(ctx: TenantContext, from: string, to: string) {
    return withDb(ctx, async (client) => {
      const { rows: totals } = await client.query(
        `SELECT
           COUNT(*)::int                                              AS total_count,
           COALESCE(SUM(amount) FILTER (WHERE status='completed'),0)::text AS total_collected,
           COALESCE(SUM(amount) FILTER (WHERE status='pending'),  0)::text AS total_pending,
           COALESCE(SUM(amount) FILTER (WHERE status='overdue'),  0)::text AS total_overdue,
           COUNT(*) FILTER (WHERE status='completed')::int          AS completed_count,
           COUNT(*) FILTER (WHERE status='pending')::int            AS pending_count,
           COUNT(*) FILTER (WHERE status='overdue')::int            AS overdue_count
         FROM contributions
         WHERE group_id = $1 AND contribution_date BETWEEN $2 AND $3`,
        [ctx.groupId, from, to],
      );

      const { rows: byMember } = await client.query(
        `SELECT
           m.first_name || ' ' || m.last_name AS member_name,
           COUNT(c.id)::int                  AS count,
           SUM(c.amount)::text               AS total
         FROM contributions c
         JOIN members m ON m.id = c.member_id
         WHERE c.group_id = $1
           AND c.contribution_date BETWEEN $2 AND $3
           AND c.status = 'completed'
         GROUP BY m.first_name, m.last_name
         ORDER BY SUM(c.amount) DESC`,
        [ctx.groupId, from, to],
      );

      const { rows: monthly } = await client.query(
        `SELECT
           DATE_TRUNC('month', contribution_date)::date::text AS month,
           COUNT(*)::int                                      AS count,
           SUM(amount)::text                                  AS total
         FROM contributions
         WHERE group_id = $1
           AND contribution_date BETWEEN $2 AND $3
           AND status = 'completed'
         GROUP BY DATE_TRUNC('month', contribution_date)
         ORDER BY month`,
        [ctx.groupId, from, to],
      );

      return { period: { from, to }, totals: totals[0], byMember, monthly };
    });
  },

  async loanReport(ctx: TenantContext) {
    return withDb(ctx, async (client) => {
      const { rows: portfolio } = await client.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'pending')::int         AS pending_applications,
           COUNT(*) FILTER (WHERE status IN ('disbursed','active'))::int AS active_loans,
           COUNT(*) FILTER (WHERE status = 'completed')::int       AS completed_loans,
           COUNT(*) FILTER (WHERE status = 'defaulted')::int       AS defaulted_loans,
           COALESCE(SUM(outstanding_balance) FILTER (WHERE status IN ('disbursed','active')),0)::text AS total_outstanding,
           COALESCE(SUM(principal_amount)    FILTER (WHERE status IN ('disbursed','active')),0)::text AS total_disbursed,
           COALESCE(SUM(principal_amount)    FILTER (WHERE status = 'defaulted'),0)::text AS total_defaulted
         FROM loans WHERE group_id = $1`,
        [ctx.groupId],
      );

      const { rows: overdue } = await client.query(
        `SELECT
           m.first_name || ' ' || m.last_name AS member_name,
           lr.due_date::text,
           lr.total_due::text,
           lr.amount_paid::text,
           (lr.total_due - lr.amount_paid)::text AS balance_due
         FROM loan_repayments lr
         JOIN members m ON m.id = lr.member_id
         WHERE lr.group_id = $1 AND lr.status IN ('pending','overdue') AND lr.due_date < CURRENT_DATE
         ORDER BY lr.due_date ASC
         LIMIT 50`,
        [ctx.groupId],
      );

      return { portfolio: portfolio[0], overdueInstallments: overdue };
    });
  },

  async financialReport(ctx: TenantContext, from: string, to: string) {
    const [profitAndLoss, balanceSheet, trialBalance] = await Promise.all([
      accountingService.getProfitAndLoss(ctx, from, to),
      accountingService.getBalanceSheet(ctx, to),
      accountingService.getTrialBalance(ctx),
    ]);
    return { profitAndLoss, balanceSheet, trialBalance };
  },
};
