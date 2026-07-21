import type { PoolClient } from 'pg';
import { withDb, type TenantContext } from '@/lib/db';
import { cached, keys } from '@/lib/redis';
import {
  periodToInterval,
  type AnalyticsPeriod,
} from '@/lib/validators/analytics.schema';

export const EXPORT_KINDS = [
  'members', 'contributions', 'loans', 'share_holdings', 'credit_scores',
] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export interface RiskAnalysis {
  generatedAt: string;
  overdueLoans: {
    loanId: string; memberId: string; firstName: string; lastName: string;
    phone: string; principalAmount: string; outstanding: string;
    nextPaymentDate: string; daysOverdue: number;
  }[];
  defaultedLoans: {
    loanId: string; memberId: string; firstName: string; lastName: string;
    phone: string; principalAmount: string; outstanding: string; status: string;
  }[];
  highRiskMembers: {
    memberId: string; firstName: string; lastName: string; phone: string;
    overallScore: number;
    reliabilityTier: 'poor' | 'high_risk';
  }[];
  idleMembers: {
    memberId: string; firstName: string; lastName: string; phone: string;
    joinedAt: string; lastContributionAt: string | null;
  }[];
  staleWelfareRequests: {
    requestId: string; memberId: string; firstName: string; lastName: string;
    phone: string; amountRequested: string; createdAt: string; daysPending: number;
  }[];
}

// ─── Public types ────────────────────────────────────────────────────────

export interface ExecutiveSummary {
  period:               AnalyticsPeriod;
  grain:                'day' | 'month';
  generatedAt:          string;

  members: {
    total:              number;
    active:             number;
    pending:            number;
    archived:           number;
    joinedInPeriod:     number;
  };

  contributions: {
    totalAmount:        string;   // all time
    periodAmount:       string;
    periodCount:        number;
    monthlyBuckets:     { bucket: string; amount: string; count: number }[];
    topMembers:         { memberId: string; firstName: string; lastName: string; amount: string }[];
  };

  loans: {
    activeCount:        number;
    activePrincipal:    string;
    outstandingBalance: string;
    repaymentsInPeriod: string;
    overdueCount:       number;
    defaultedCount:     number;
    topBorrowers:       { memberId: string; firstName: string; lastName: string; outstanding: string }[];
    monthlyRepayments:  { bucket: string; amount: string }[];
  };

  welfare: {
    poolBalance:        string;
    totalDisbursed:     string;
    pendingRequests:    number;
  };

  shares: {
    shareCapital:       string;   // SUM(quantity × effective_value)
    sharesIssued:       number;
    shareholders:       number;
    topHolders:         { memberId: string; firstName: string; lastName: string; shares: number; invested: string }[];
  };

  dividends: {
    totalDeclared:      string;
    totalPaid:          string;
    lastDeclarationAt:  string | null;
    lastDeclarationLabel: string | null;
  };

  creditScores: {
    scoredMembers:      number;
    averageOverall:     string;
    byTier:             Record<'excellent' | 'good' | 'fair' | 'poor' | 'high_risk', number>;
  };

  /**
   * Quick health proxy: contributions + share capital − outstanding loan
   * principal. Not a real balance sheet (welfare pool, investments not
   * included) — just a one-number gut-check trend indicator.
   */
  financialHealth: {
    grossAssets:        string;
    liabilities:        string;
    netPosition:        string;
  };
}

// ─── Service ────────────────────────────────────────────────────────────

export const analyticsService = {

  async getExecutiveSummary(ctx: TenantContext, period: AnalyticsPeriod): Promise<ExecutiveSummary> {
    const { interval, grain } = periodToInterval(period);

    return cached(keys.cache('executive-summary', `${ctx.groupId}:${period}`), 60, () => withDb(ctx, async (client) => {
      const groupId = ctx.groupId;

      // Run every aggregation in parallel. Most are single-row scans; the
      // time-series buckets are bounded by the period filter so they don't
      // exceed ~365 day-rows or ~12 month-rows.
      const [
        memberRows,
        contribTotals,
        contribBuckets,
        contribTop,
        loanTotals,
        loanRepayPeriod,
        loanTop,
        loanBuckets,
        welfareSummary,
        welfarePending,
        sharesSummary,
        sharesTop,
        divsSummary,
        divsLast,
        creditDistribution,
      ] = await Promise.all([
        client.query<{
          total: string; active: string; pending: string; archived: string; joined_in_period: string;
        }>(
          `SELECT
             COUNT(*)::text                                                       AS total,
             COUNT(*) FILTER (WHERE status = 'active')::text                      AS active,
             COUNT(*) FILTER (WHERE status = 'pending_verification')::text        AS pending,
             COUNT(*) FILTER (WHERE status = 'archived')::text                    AS archived,
             COUNT(*) FILTER (WHERE joined_at >= NOW() - $2::interval)::text      AS joined_in_period
           FROM group_members
           WHERE group_id = $1`,
          [groupId, interval],
        ),

        client.query<{
          all_time: string; period_amount: string; period_count: string;
        }>(
          `SELECT
             COALESCE(SUM(amount), 0)::text                                          AS all_time,
             COALESCE(SUM(amount) FILTER (
               WHERE contribution_date >= CURRENT_DATE - $2::interval
             ), 0)::text                                                             AS period_amount,
             COUNT(*) FILTER (
               WHERE contribution_date >= CURRENT_DATE - $2::interval
             )::text                                                                 AS period_count
           FROM contributions
           WHERE group_id = $1 AND status = 'completed'`,
          [groupId, interval],
        ),

        client.query<{ bucket: string; amount: string; count: string }>(
          `SELECT
             DATE_TRUNC($3, contribution_date)::date::text  AS bucket,
             COALESCE(SUM(amount), 0)::text                 AS amount,
             COUNT(*)::text                                 AS count
           FROM contributions
           WHERE group_id = $1
             AND status = 'completed'
             AND contribution_date >= CURRENT_DATE - $2::interval
           GROUP BY 1
           ORDER BY 1 ASC`,
          [groupId, interval, grain],
        ),

        client.query<{
          member_id: string; first_name: string; last_name: string; total: string;
        }>(
          `SELECT
             c.member_id,
             m.first_name,
             m.last_name,
             SUM(c.amount)::text AS total
           FROM contributions c
           JOIN members m ON m.id = c.member_id
           WHERE c.group_id = $1
             AND c.status = 'completed'
             AND c.contribution_date >= CURRENT_DATE - $2::interval
           GROUP BY c.member_id, m.first_name, m.last_name
           ORDER BY total DESC
           LIMIT 5`,
          [groupId, interval],
        ),

        client.query<{
          active_count: string; active_principal: string; outstanding: string;
          overdue_count: string; defaulted_count: string;
        }>(
          `SELECT
             COUNT(*) FILTER (WHERE status IN ('active', 'disbursed'))::text                  AS active_count,
             COALESCE(SUM(principal_amount) FILTER (WHERE status IN ('active', 'disbursed')), 0)::text     AS active_principal,
             COALESCE(SUM(outstanding_balance) FILTER (WHERE status IN ('active', 'disbursed')), 0)::text  AS outstanding,
             COUNT(*) FILTER (WHERE next_payment_date < CURRENT_DATE AND status IN ('active', 'disbursed'))::text AS overdue_count,
             COUNT(*) FILTER (WHERE status IN ('defaulted', 'written_off'))::text             AS defaulted_count
           FROM loans
           WHERE group_id = $1`,
          [groupId],
        ),

        client.query<{ paid_in_period: string }>(
          `SELECT COALESCE(SUM(amount_paid), 0)::text AS paid_in_period
             FROM loan_repayments
            WHERE group_id = $1
              AND status = 'completed'
              AND payment_date >= CURRENT_DATE - $2::interval`,
          [groupId, interval],
        ),

        client.query<{
          member_id: string; first_name: string; last_name: string; outstanding: string;
        }>(
          `SELECT
             l.member_id,
             m.first_name,
             m.last_name,
             SUM(l.outstanding_balance)::text AS outstanding
           FROM loans l
           JOIN members m ON m.id = l.member_id
           WHERE l.group_id = $1 AND l.status IN ('active', 'disbursed')
           GROUP BY l.member_id, m.first_name, m.last_name
           ORDER BY outstanding DESC
           LIMIT 5`,
          [groupId],
        ),

        client.query<{ bucket: string; amount: string }>(
          `SELECT
             DATE_TRUNC($3, payment_date)::date::text AS bucket,
             COALESCE(SUM(amount_paid), 0)::text      AS amount
           FROM loan_repayments
           WHERE group_id = $1
             AND status = 'completed'
             AND payment_date >= CURRENT_DATE - $2::interval
           GROUP BY 1
           ORDER BY 1 ASC`,
          [groupId, interval, grain],
        ),

        // Welfare summary tolerates the module being empty or partly-populated.
        client.query<{ balance: string; total_disbursed: string }>(
          `SELECT
             (COALESCE((SELECT SUM(amount) FROM welfare_pool_contributions WHERE group_id = $1), 0)
              - COALESCE((SELECT SUM(amount_disbursed) FROM welfare_requests
                          WHERE group_id = $1 AND status IN ('approved', 'disbursed')), 0))::text AS balance,
             COALESCE((SELECT SUM(amount_disbursed) FROM welfare_requests
                       WHERE group_id = $1 AND status IN ('approved', 'disbursed')), 0)::text    AS total_disbursed`,
          [groupId],
        ),

        client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
             FROM welfare_requests
            WHERE group_id = $1 AND status = 'pending'`,
          [groupId],
        ),

        client.query<{
          capital: string; shares_issued: string; shareholders: string;
        }>(
          `SELECT
             COALESCE(SUM(h.quantity * COALESCE(c.current_value, c.par_value)), 0)::text AS capital,
             COALESCE(SUM(h.quantity), 0)::text                                          AS shares_issued,
             COUNT(DISTINCT h.member_id)::text                                           AS shareholders
           FROM share_holdings h
           JOIN share_classes c ON c.id = h.share_class_id
           WHERE h.group_id = $1 AND h.quantity > 0`,
          [groupId],
        ),

        client.query<{
          member_id: string; first_name: string; last_name: string;
          shares: string; invested: string;
        }>(
          `SELECT
             h.member_id,
             m.first_name,
             m.last_name,
             SUM(h.quantity)::text       AS shares,
             SUM(h.total_invested)::text AS invested
           FROM share_holdings h
           JOIN members m ON m.id = h.member_id
           WHERE h.group_id = $1 AND h.quantity > 0
           GROUP BY h.member_id, m.first_name, m.last_name
           ORDER BY shares DESC
           LIMIT 5`,
          [groupId],
        ),

        client.query<{
          total_declared: string; total_paid: string;
        }>(
          `SELECT
             COALESCE(SUM(pool_amount), 0)::text                                       AS total_declared,
             COALESCE(SUM(total_paid),  0)::text                                       AS total_paid
           FROM dividend_declarations
           WHERE group_id = $1 AND status <> 'cancelled'`,
          [groupId],
        ),

        client.query<{
          period_label: string; approved_at: string | null; declared_at: string;
        }>(
          `SELECT period_label, approved_at, declared_at
             FROM dividend_declarations
            WHERE group_id = $1 AND status <> 'cancelled'
            ORDER BY declared_at DESC
            LIMIT 1`,
          [groupId],
        ),

        client.query<{
          tier: 'excellent' | 'good' | 'fair' | 'poor' | 'high_risk';
          score: string;
        }>(
          `SELECT DISTINCT ON (member_id) reliability_tier AS tier, overall_score AS score
             FROM credit_scores
            WHERE group_id = $1
            ORDER BY member_id, computed_at DESC`,
          [groupId],
        ),
      ]);

      const memberRow = memberRows.rows[0];

      const byTier = { excellent: 0, good: 0, fair: 0, poor: 0, high_risk: 0 };
      let scoreSum = 0;
      for (const r of creditDistribution.rows) {
        byTier[r.tier]++;
        scoreSum += Number(r.score);
      }
      const scoredCount = creditDistribution.rows.length;
      const avgScore    = scoredCount > 0 ? scoreSum / scoredCount : 0;

      // Financial health proxy. Welfare pool and investments excluded — they
      // belong to the group as a whole, not allocated to individual members,
      // and including them muddies the trend signal.
      const grossAssets =
        Number(contribTotals.rows[0].all_time) +
        Number(sharesSummary.rows[0].capital);
      const liabilities = Number(loanTotals.rows[0].outstanding);
      const netPosition = grossAssets - liabilities;

      return {
        period,
        grain,
        generatedAt: new Date().toISOString(),

        members: {
          total:          parseInt(memberRow.total,            10),
          active:         parseInt(memberRow.active,           10),
          pending:        parseInt(memberRow.pending,          10),
          archived:       parseInt(memberRow.archived,         10),
          joinedInPeriod: parseInt(memberRow.joined_in_period, 10),
        },

        contributions: {
          totalAmount:    contribTotals.rows[0].all_time,
          periodAmount:   contribTotals.rows[0].period_amount,
          periodCount:    parseInt(contribTotals.rows[0].period_count, 10),
          monthlyBuckets: contribBuckets.rows.map((b) => ({
            bucket: b.bucket, amount: b.amount, count: parseInt(b.count, 10),
          })),
          topMembers: contribTop.rows.map((r) => ({
            memberId: r.member_id, firstName: r.first_name, lastName: r.last_name, amount: r.total,
          })),
        },

        loans: {
          activeCount:        parseInt(loanTotals.rows[0].active_count, 10),
          activePrincipal:    loanTotals.rows[0].active_principal,
          outstandingBalance: loanTotals.rows[0].outstanding,
          repaymentsInPeriod: loanRepayPeriod.rows[0].paid_in_period,
          overdueCount:       parseInt(loanTotals.rows[0].overdue_count,   10),
          defaultedCount:     parseInt(loanTotals.rows[0].defaulted_count, 10),
          topBorrowers: loanTop.rows.map((r) => ({
            memberId: r.member_id, firstName: r.first_name, lastName: r.last_name, outstanding: r.outstanding,
          })),
          monthlyRepayments: loanBuckets.rows.map((b) => ({
            bucket: b.bucket, amount: b.amount,
          })),
        },

        welfare: {
          poolBalance:     welfareSummary.rows[0].balance,
          totalDisbursed:  welfareSummary.rows[0].total_disbursed,
          pendingRequests: parseInt(welfarePending.rows[0].count, 10),
        },

        shares: {
          shareCapital: sharesSummary.rows[0].capital,
          sharesIssued: parseInt(sharesSummary.rows[0].shares_issued, 10),
          shareholders: parseInt(sharesSummary.rows[0].shareholders,  10),
          topHolders: sharesTop.rows.map((r) => ({
            memberId: r.member_id, firstName: r.first_name, lastName: r.last_name,
            shares: parseInt(r.shares, 10), invested: r.invested,
          })),
        },

        dividends: {
          totalDeclared:        divsSummary.rows[0].total_declared,
          totalPaid:            divsSummary.rows[0].total_paid,
          lastDeclarationAt:    divsLast.rows[0]?.declared_at ?? null,
          lastDeclarationLabel: divsLast.rows[0]?.period_label ?? null,
        },

        creditScores: {
          scoredMembers:  scoredCount,
          averageOverall: avgScore.toFixed(2),
          byTier,
        },

        financialHealth: {
          grossAssets: grossAssets.toFixed(2),
          liabilities: liabilities.toFixed(2),
          netPosition: netPosition.toFixed(2),
        },
      };
    }));
  },

  // ── CSV exports (E8.2) ───────────────────────────────────────────────

  async exportCsv(ctx: TenantContext, kind: ExportKind): Promise<{ csv: string; filename: string }> {
    return withDb(ctx, async (client) => {
      switch (kind) {
        case 'members':         return exportMembers(client, ctx.groupId);
        case 'contributions':   return exportContributions(client, ctx.groupId);
        case 'loans':           return exportLoans(client, ctx.groupId);
        case 'share_holdings':  return exportShareHoldings(client, ctx.groupId);
        case 'credit_scores':   return exportCreditScores(client, ctx.groupId);
      }
    });
  },

  // ── Risk analysis (E8.2) ─────────────────────────────────────────────

  async getRiskAnalysis(ctx: TenantContext): Promise<RiskAnalysis> {
    return cached(keys.cache('risk-analysis', ctx.groupId), 60, () => withDb(ctx, async (client) => {
      const groupId = ctx.groupId;
      const [
        overdueLoans,
        defaultedLoans,
        riskMembers,
        idleMembers,
        staleWelfare,
      ] = await Promise.all([
        client.query<{
          loan_id: string; member_id: string; first_name: string; last_name: string;
          phone: string; principal_amount: string; outstanding_balance: string;
          next_payment_date: string; days_overdue: string;
        }>(
          `SELECT
             l.id            AS loan_id,
             l.member_id,
             m.first_name,
             m.last_name,
             m.phone,
             l.principal_amount::text,
             l.outstanding_balance::text,
             l.next_payment_date::text,
             (CURRENT_DATE - l.next_payment_date)::text AS days_overdue
           FROM loans l
           JOIN members m ON m.id = l.member_id
           WHERE l.group_id = $1
             AND l.status IN ('active', 'disbursed')
             AND l.next_payment_date < CURRENT_DATE
           ORDER BY (CURRENT_DATE - l.next_payment_date) DESC
           LIMIT 50`,
          [groupId],
        ),

        client.query<{
          loan_id: string; member_id: string; first_name: string; last_name: string;
          phone: string; principal_amount: string; outstanding_balance: string;
          status: string;
        }>(
          `SELECT
             l.id            AS loan_id,
             l.member_id,
             m.first_name,
             m.last_name,
             m.phone,
             l.principal_amount::text,
             l.outstanding_balance::text,
             l.status::text
           FROM loans l
           JOIN members m ON m.id = l.member_id
           WHERE l.group_id = $1
             AND l.status IN ('defaulted', 'written_off')
           ORDER BY l.outstanding_balance DESC
           LIMIT 50`,
          [groupId],
        ),

        client.query<{
          member_id: string; first_name: string; last_name: string;
          phone: string; overall_score: string; reliability_tier: string;
        }>(
          // DISTINCT ON picks the latest score per member, then we filter
          // to the worst-2 tiers. Sub-query is needed because DISTINCT ON
          // + a WHERE on the chosen field don't mix in one statement.
          `SELECT * FROM (
             SELECT DISTINCT ON (cs.member_id)
                    cs.member_id,
                    m.first_name,
                    m.last_name,
                    m.phone,
                    cs.overall_score::text,
                    cs.reliability_tier::text
               FROM credit_scores cs
               JOIN members m ON m.id = cs.member_id
              WHERE cs.group_id = $1
              ORDER BY cs.member_id, cs.computed_at DESC
           ) latest
           WHERE latest.reliability_tier IN ('poor', 'high_risk')
           ORDER BY latest.overall_score ASC
           LIMIT 50`,
          [groupId],
        ),

        // Idle = active group member with no completed contribution in
        // the last 90 days. We use a NOT EXISTS so the index on
        // (group_id, member_id, status) drives the lookup cheaply.
        client.query<{
          member_id: string; first_name: string; last_name: string;
          phone: string; joined_at: string; last_contribution_at: string | null;
        }>(
          `SELECT
             gm.member_id,
             m.first_name,
             m.last_name,
             m.phone,
             gm.joined_at::text,
             (
               SELECT MAX(c.contribution_date)::text
                 FROM contributions c
                WHERE c.group_id  = $1
                  AND c.member_id = gm.member_id
                  AND c.status    = 'completed'
             ) AS last_contribution_at
           FROM group_members gm
           JOIN members m ON m.id = gm.member_id
           WHERE gm.group_id = $1
             AND gm.status   = 'active'
             AND NOT EXISTS (
               SELECT 1 FROM contributions c
                WHERE c.group_id  = $1
                  AND c.member_id = gm.member_id
                  AND c.status    = 'completed'
                  AND c.contribution_date >= (CURRENT_DATE - INTERVAL '90 days')
             )
           ORDER BY gm.joined_at ASC
           LIMIT 50`,
          [groupId],
        ),

        // Stale = pending welfare request > 14 days old. Operators forget
        // these; surfacing them prevents requests from rotting.
        client.query<{
          request_id: string; member_id: string; first_name: string; last_name: string;
          phone: string; amount_requested: string; created_at: string; days_pending: string;
        }>(
          `SELECT
             w.id           AS request_id,
             w.member_id,
             m.first_name,
             m.last_name,
             m.phone,
             w.amount_requested::text,
             w.created_at::text,
             EXTRACT(DAY FROM (NOW() - w.created_at))::text AS days_pending
           FROM welfare_requests w
           JOIN members m ON m.id = w.member_id
           WHERE w.group_id = $1
             AND w.status   = 'pending'
             AND w.created_at < (NOW() - INTERVAL '14 days')
           ORDER BY w.created_at ASC
           LIMIT 50`,
          [groupId],
        ),
      ]);

      const out: RiskAnalysis = {
        generatedAt: new Date().toISOString(),
        overdueLoans: overdueLoans.rows.map((r) => ({
          loanId:          r.loan_id,
          memberId:        r.member_id,
          firstName:       r.first_name,
          lastName:        r.last_name,
          phone:           r.phone,
          principalAmount: r.principal_amount,
          outstanding:     r.outstanding_balance,
          nextPaymentDate: r.next_payment_date,
          daysOverdue:     parseInt(r.days_overdue, 10),
        })),
        defaultedLoans: defaultedLoans.rows.map((r) => ({
          loanId:          r.loan_id,
          memberId:        r.member_id,
          firstName:       r.first_name,
          lastName:        r.last_name,
          phone:           r.phone,
          principalAmount: r.principal_amount,
          outstanding:     r.outstanding_balance,
          status:          r.status,
        })),
        highRiskMembers: riskMembers.rows.map((r) => ({
          memberId:        r.member_id,
          firstName:       r.first_name,
          lastName:        r.last_name,
          phone:           r.phone,
          overallScore:    Number(r.overall_score),
          reliabilityTier: r.reliability_tier as RiskAnalysis['highRiskMembers'][0]['reliabilityTier'],
        })),
        idleMembers: idleMembers.rows.map((r) => ({
          memberId:           r.member_id,
          firstName:          r.first_name,
          lastName:           r.last_name,
          phone:              r.phone,
          joinedAt:           r.joined_at,
          lastContributionAt: r.last_contribution_at,
        })),
        staleWelfareRequests: staleWelfare.rows.map((r) => ({
          requestId:       r.request_id,
          memberId:        r.member_id,
          firstName:       r.first_name,
          lastName:        r.last_name,
          phone:           r.phone,
          amountRequested: r.amount_requested,
          createdAt:       r.created_at,
          daysPending:     parseInt(r.days_pending, 10),
        })),
      };
      return out;
    }));
  },
};

// ─── CSV builders ──────────────────────────────────────────────────────

async function exportMembers(client: PoolClient, groupId: string): Promise<{ csv: string; filename: string }> {
  const { rows } = await client.query<Record<string, string | null>>(
    `SELECT
       m.phone, m.first_name, m.middle_name, m.last_name, m.email,
       m.national_id, m.date_of_birth::text AS date_of_birth, m.gender,
       m.alternative_phone, m.occupation,
       cnt.name AS county_name,
       gm.role,
       gm.status AS membership_status,
       gm.joined_at::text AS joined_at
     FROM group_members gm
     JOIN members m  ON m.id = gm.member_id
     LEFT JOIN counties cnt ON cnt.id = m.county_id
     WHERE gm.group_id = $1
     ORDER BY m.first_name, m.last_name`,
    [groupId],
  );
  const headers = ['phone', 'first_name', 'middle_name', 'last_name', 'email',
    'national_id', 'date_of_birth', 'gender', 'alternative_phone', 'occupation',
    'county_name', 'role', 'membership_status', 'joined_at'];
  return { csv: rowsToCsv(headers, rows), filename: csvFilename('members') };
}

async function exportContributions(client: PoolClient, groupId: string): Promise<{ csv: string; filename: string }> {
  const { rows } = await client.query<Record<string, string | null>>(
    `SELECT
       m.phone               AS member_phone,
       m.first_name          AS member_first_name,
       m.last_name           AS member_last_name,
       c.amount::text        AS amount,
       c.contribution_date::text AS contribution_date,
       c.payment_method::text AS payment_method,
       c.mpesa_receipt_number AS mpesa_receipt,
       c.status::text        AS status,
       c.notes
     FROM contributions c
     JOIN members m ON m.id = c.member_id
     WHERE c.group_id = $1
     ORDER BY c.contribution_date DESC, c.created_at DESC`,
    [groupId],
  );
  const headers = ['member_phone', 'member_first_name', 'member_last_name',
    'amount', 'contribution_date', 'payment_method', 'mpesa_receipt', 'status', 'notes'];
  return { csv: rowsToCsv(headers, rows), filename: csvFilename('contributions') };
}

async function exportLoans(client: PoolClient, groupId: string): Promise<{ csv: string; filename: string }> {
  const { rows } = await client.query<Record<string, string | null>>(
    `SELECT
       m.phone                  AS member_phone,
       m.first_name             AS member_first_name,
       m.last_name              AS member_last_name,
       l.principal_amount::text AS principal_amount,
       l.interest_rate::text    AS interest_rate,
       l.loan_term_months::text AS term_months,
       l.disbursement_date::text AS disbursement_date,
       l.status::text           AS status,
       l.total_repayable::text  AS total_repayable,
       l.outstanding_balance::text AS outstanding_balance,
       l.next_payment_date::text AS next_payment_date,
       l.purpose,
       l.notes
     FROM loans l
     JOIN members m ON m.id = l.member_id
     WHERE l.group_id = $1
     ORDER BY l.disbursement_date DESC NULLS LAST, l.created_at DESC`,
    [groupId],
  );
  const headers = ['member_phone', 'member_first_name', 'member_last_name',
    'principal_amount', 'interest_rate', 'term_months', 'disbursement_date',
    'status', 'total_repayable', 'outstanding_balance', 'next_payment_date',
    'purpose', 'notes'];
  return { csv: rowsToCsv(headers, rows), filename: csvFilename('loans') };
}

async function exportShareHoldings(client: PoolClient, groupId: string): Promise<{ csv: string; filename: string }> {
  const { rows } = await client.query<Record<string, string | null>>(
    `SELECT
       m.phone               AS member_phone,
       m.first_name          AS member_first_name,
       m.last_name           AS member_last_name,
       c.name                AS share_class_name,
       c.code                AS share_class_code,
       h.quantity::text      AS quantity,
       COALESCE(c.current_value, c.par_value)::text AS effective_value,
       (h.quantity * COALESCE(c.current_value, c.par_value))::text AS current_value,
       h.total_invested::text AS total_invested,
       h.first_acquired_at::text AS first_acquired_at,
       h.last_transaction_at::text AS last_transaction_at
     FROM share_holdings h
     JOIN members m ON m.id = h.member_id
     JOIN share_classes c ON c.id = h.share_class_id
     WHERE h.group_id = $1 AND h.quantity > 0
     ORDER BY h.quantity DESC`,
    [groupId],
  );
  const headers = ['member_phone', 'member_first_name', 'member_last_name',
    'share_class_name', 'share_class_code', 'quantity', 'effective_value',
    'current_value', 'total_invested', 'first_acquired_at', 'last_transaction_at'];
  return { csv: rowsToCsv(headers, rows), filename: csvFilename('share-holdings') };
}

async function exportCreditScores(client: PoolClient, groupId: string): Promise<{ csv: string; filename: string }> {
  // DISTINCT ON keeps only the latest snapshot per member.
  const { rows } = await client.query<Record<string, string | null>>(
    `SELECT DISTINCT ON (cs.member_id)
       m.phone               AS member_phone,
       m.first_name          AS member_first_name,
       m.last_name           AS member_last_name,
       cs.overall_score::text  AS overall_score,
       cs.financial_score::text AS financial_score,
       cs.social_score::text    AS social_score,
       cs.reliability_tier::text AS reliability_tier,
       cs.loan_eligibility_limit::text AS loan_eligibility_limit,
       cs.computed_at::text   AS computed_at
     FROM credit_scores cs
     JOIN members m ON m.id = cs.member_id
     WHERE cs.group_id = $1
     ORDER BY cs.member_id, cs.computed_at DESC`,
    [groupId],
  );
  const headers = ['member_phone', 'member_first_name', 'member_last_name',
    'overall_score', 'financial_score', 'social_score', 'reliability_tier',
    'loan_eligibility_limit', 'computed_at'];
  return { csv: rowsToCsv(headers, rows), filename: csvFilename('credit-scores') };
}

// ─── CSV helpers ───────────────────────────────────────────────────────

function rowsToCsv(headers: string[], rows: Record<string, string | null>[]): string {
  const headerLine = headers.join(',');
  if (rows.length === 0) return headerLine + '\n';
  const dataLines = rows.map((r) =>
    headers.map((h) => csvEscape(r[h])).join(','),
  );
  return [headerLine, ...dataLines].join('\n') + '\n';
}

function csvEscape(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvFilename(kind: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `kitabuyetu-${kind}-${today}.csv`;
}
