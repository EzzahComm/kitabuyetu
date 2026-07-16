import type { PoolClient } from 'pg';
import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/utils/errors';
import type {
  CreditScoreQueryInput, ScoreHistoryQueryInput, ReliabilityTier,
} from '@/lib/validators/credit-scores.schema';
import { getEffectiveTierThresholds, type TierThreshold } from './loan-policy.service';

// ─── Public types ────────────────────────────────────────────────────────

export interface ComponentScore {
  /** 0–100 */
  score:  number;
  /** 0–1 (weight of this component in the composite) */
  weight: number;
  /** Underlying raw metrics that produced the score, for transparency. */
  raw:    Record<string, unknown>;
}

export interface CreditScore {
  id:                     string;
  group_id:               string;
  member_id:              string;
  computed_at:            string;
  computed_by:            string | null;
  financial_score:        string;
  social_score:           string;
  overall_score:          string;
  components:             Record<string, ComponentScore>;
  reliability_tier:       ReliabilityTier;
  loan_eligibility_limit: string;
  notes:                  string | null;

  // Joined for list/detail views.
  member_first_name?:     string;
  member_last_name?:      string;
  member_phone?:          string;
}

export interface ScoreSummary {
  totalMembers:   number;
  scoredMembers:  number;
  averageOverall: string;
  byTier:         Record<ReliabilityTier, number>;
}

// ─── Scoring config — single source of truth for weights + tier thresholds ─

// Financial-dimension weights (sum to 1.0). These define what fraction of the
// financial_score each component contributes.
const FINANCIAL_WEIGHTS = {
  contribution_consistency: 0.30,
  loan_repayment:           0.30,
  savings_growth:           0.20,
  share_ownership:          0.15,
  dividend_participation:   0.05,
} as const;

// Social-dimension weights (sum to 1.0). E6.2 Part 1 ships 3 components;
// peer endorsements + event participation queued for E6.3.
const SOCIAL_WEIGHTS = {
  meeting_attendance:     0.50,
  welfare_participation:  0.25,
  leadership_role:        0.25,
} as const;

// Composite blend: overall = FINANCIAL_BLEND × financial + SOCIAL_BLEND × social.
// Financial is weighted heavier because it has more signal density (5
// components vs 3) and the underlying data is more reliable.
const FINANCIAL_BLEND = 0.70;
const SOCIAL_BLEND    = 0.30;

type FinancialKey = keyof typeof FINANCIAL_WEIGHTS;
type SocialKey    = keyof typeof SOCIAL_WEIGHTS;
type ComponentKey = FinancialKey | SocialKey;

// Kept as a single map for compatibility with the existing service code that
// reads `c.weight` per component. Each component's `weight` is its share
// *within its dimension* — so the financial keys all sum to 1.0 and the
// social keys all sum to 1.0, separately.
const COMPONENT_WEIGHTS: Record<ComponentKey, number> = {
  ...FINANCIAL_WEIGHTS,
  ...SOCIAL_WEIGHTS,
};


// ─── Service ────────────────────────────────────────────────────────────

export const creditScoresService = {

  /**
   * Compute and persist a score snapshot for one member. The append-only
   * design means each recompute creates a new row; the "current" score is
   * always the most recent row.
   */
  async recomputeForMember(ctx: TenantContext, memberId: string): Promise<CreditScore> {
    return withTransaction(ctx, async (client) => {
      await assertGroupMembership(client, ctx.groupId, memberId);

      const tierThresholds = await getEffectiveTierThresholds(client, { groupId: ctx.groupId, organizationId: ctx.organizationId });
      const components = await computeComponents(client, ctx.groupId, memberId);
      const result     = synthesise(components, tierThresholds);

      const { rows } = await client.query<CreditScore>(
        `INSERT INTO credit_scores (
           group_id, member_id, computed_by,
           financial_score, social_score, overall_score,
           components, reliability_tier, loan_eligibility_limit
         ) VALUES (
           $1, $2, $3,
           $4, $5, $6,
           $7::jsonb, $8::credit_reliability_tier, $9
         )
         RETURNING *`,
        [
          ctx.groupId, memberId, ctx.userId,
          result.financialScore.toFixed(2),
          result.socialScore.toFixed(2),
          result.overallScore.toFixed(2),
          JSON.stringify(components),
          result.tier,
          result.loanEligibility.toFixed(2),
        ],
      );
      await writeAuditLog(client, ctx, 'credit_score.compute', rows[0].id, {
        member_id: memberId,
        overall:   result.overallScore,
        tier:      result.tier,
      });
      return rows[0];
    });
  },

  /**
   * Recompute scores for every active member in the group. Returns counts.
   * Run inside one transaction so a half-finished sweep doesn't leave the
   * group with mixed-vintage snapshots.
   */
  async recomputeAll(ctx: TenantContext): Promise<{ recomputed: number; failed: { memberId: string; reason: string }[] }> {
    return withTransaction(ctx, async (client) => {
      const { rows: members } = await client.query<{ member_id: string }>(
        `SELECT member_id FROM group_members
          WHERE group_id = $1 AND status = 'active'`,
        [ctx.groupId],
      );

      const tierThresholds = await getEffectiveTierThresholds(client, { groupId: ctx.groupId, organizationId: ctx.organizationId });
      let recomputed = 0;
      const failed: { memberId: string; reason: string }[] = [];

      for (const m of members) {
        try {
          const components = await computeComponents(client, ctx.groupId, m.member_id);
          const result     = synthesise(components, tierThresholds);
          await client.query(
            `INSERT INTO credit_scores (
               group_id, member_id, computed_by,
               financial_score, social_score, overall_score,
               components, reliability_tier, loan_eligibility_limit
             ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::credit_reliability_tier, $9)`,
            [
              ctx.groupId, m.member_id, ctx.userId,
              result.financialScore.toFixed(2),
              result.socialScore.toFixed(2),
              result.overallScore.toFixed(2),
              JSON.stringify(components),
              result.tier,
              result.loanEligibility.toFixed(2),
            ],
          );
          recomputed++;
        } catch (err) {
          failed.push({ memberId: m.member_id, reason: (err as Error).message });
        }
      }

      await writeAuditLog(client, ctx, 'credit_score.recompute_all', ctx.groupId, {
        recomputed, failed: failed.length,
      });
      return { recomputed, failed };
    });
  },

  /** List the latest score per member in the group. */
  async listLatest(ctx: TenantContext, params: CreditScoreQueryInput) {
    return withDb(ctx, async (client) => {
      const offset = (params.page - 1) * params.limit;
      const conds: string[] = ['cs.group_id = $1'];
      const vals:  unknown[] = [ctx.groupId];
      if (params.tier)     { conds.push(`cs.reliability_tier = $${vals.length + 1}`);   vals.push(params.tier); }
      if (params.maxScore !== undefined) {
        conds.push(`cs.overall_score <= $${vals.length + 1}`); vals.push(params.maxScore);
      }
      const where = conds.join(' AND ');

      // DISTINCT ON (cs.member_id) keeps only the latest snapshot per member
      // — relies on the idx_credit_scores_member_latest index for performance.
      const [{ rows: cnt }, { rows: items }] = await Promise.all([
        client.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM (
             SELECT DISTINCT ON (cs.member_id) cs.id
               FROM credit_scores cs
              WHERE ${where}
              ORDER BY cs.member_id, cs.computed_at DESC
           ) latest`,
          vals,
        ),
        client.query<CreditScore>(
          `SELECT * FROM (
             SELECT DISTINCT ON (cs.member_id)
                    cs.*,
                    m.first_name AS member_first_name,
                    m.last_name  AS member_last_name,
                    m.phone      AS member_phone
               FROM credit_scores cs
               JOIN members m ON m.id = cs.member_id
              WHERE ${where}
              ORDER BY cs.member_id, cs.computed_at DESC
           ) latest
           ORDER BY latest.overall_score DESC, latest.member_first_name ASC
           LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`,
          [...vals, params.limit, offset],
        ),
      ]);

      const total = parseInt(cnt[0].count, 10);
      return {
        items, total,
        page: params.page, pageSize: params.limit,
        totalPages: Math.max(1, Math.ceil(total / params.limit)),
      };
    });
  },

  async getLatestForMember(ctx: TenantContext, memberId: string): Promise<CreditScore> {
    return withDb(ctx, async (client) => {
      await assertGroupMembership(client, ctx.groupId, memberId);
      const { rows } = await client.query<CreditScore>(
        `SELECT cs.*,
                m.first_name AS member_first_name,
                m.last_name  AS member_last_name,
                m.phone      AS member_phone
           FROM credit_scores cs
           JOIN members m ON m.id = cs.member_id
          WHERE cs.group_id = $1 AND cs.member_id = $2
          ORDER BY cs.computed_at DESC
          LIMIT 1`,
        [ctx.groupId, memberId],
      );
      if (!rows[0]) {
        throw new NotFoundError('Credit score for member', memberId);
      }
      return rows[0];
    });
  },

  async getHistoryForMember(ctx: TenantContext, memberId: string, params: ScoreHistoryQueryInput): Promise<CreditScore[]> {
    return withDb(ctx, async (client) => {
      await assertGroupMembership(client, ctx.groupId, memberId);
      const { rows } = await client.query<CreditScore>(
        `SELECT cs.*
           FROM credit_scores cs
          WHERE cs.group_id = $1 AND cs.member_id = $2
          ORDER BY cs.computed_at DESC
          LIMIT $3`,
        [ctx.groupId, memberId, params.limit],
      );
      return rows;
    });
  },

  async getGroupSummary(ctx: TenantContext): Promise<ScoreSummary> {
    return withDb(ctx, async (client) => {
      const [activeQ, latestQ] = await Promise.all([
        client.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM group_members
            WHERE group_id = $1 AND status = 'active'`,
          [ctx.groupId],
        ),
        client.query<{
          reliability_tier: ReliabilityTier;
          overall_score: string;
        }>(
          `SELECT DISTINCT ON (member_id)
                  reliability_tier, overall_score
             FROM credit_scores
            WHERE group_id = $1
            ORDER BY member_id, computed_at DESC`,
          [ctx.groupId],
        ),
      ]);

      const byTier: Record<ReliabilityTier, number> = {
        excellent: 0, good: 0, fair: 0, poor: 0, high_risk: 0,
      };
      let total = 0;
      for (const r of latestQ.rows) {
        byTier[r.reliability_tier]++;
        total += Number(r.overall_score);
      }
      const scoredCount = latestQ.rows.length;
      const avg         = scoredCount > 0 ? total / scoredCount : 0;

      return {
        totalMembers:   parseInt(activeQ.rows[0].count, 10),
        scoredMembers:  scoredCount,
        averageOverall: avg.toFixed(2),
        byTier,
      };
    });
  },
};

// ─── Scoring engine ──────────────────────────────────────────────────────

interface SynthesisResult {
  financialScore:  number;
  socialScore:     number;
  overallScore:    number;
  tier:            ReliabilityTier;
  loanEligibility: number;
}

// Exported for direct unit testing of the tier-resolution logic (§29's
// LoanPolicy proof) without needing to mock computeComponents' full chain
// of sub-queries.
export function synthesise(
  components:      Record<ComponentKey, ComponentScore>,
  tierThresholds:  TierThreshold[],
): SynthesisResult {
  // Financial dimension = weighted sum of the financial components.
  let financial = 0;
  for (const key of Object.keys(FINANCIAL_WEIGHTS) as FinancialKey[]) {
    const c = components[key];
    financial += c.score * c.weight;
  }
  financial = clamp(financial, 0, 100);

  // Social dimension = weighted sum of the social components (E6.2).
  let social = 0;
  for (const key of Object.keys(SOCIAL_WEIGHTS) as SocialKey[]) {
    const c = components[key];
    social += c.score * c.weight;
  }
  social = clamp(social, 0, 100);

  // Composite. Weighted blend of the two dimensions — financial heavier
  // because it has more signal density and more reliable underlying data.
  const overall = clamp(financial * FINANCIAL_BLEND + social * SOCIAL_BLEND, 0, 100);

  const tierRow = tierThresholds.find((t) => overall >= t.min)!;
  // total_savings comes from the contribution_consistency raw payload so we
  // don't need a second DB query just to size the loan ceiling.
  const savings = Number(
    (components.contribution_consistency.raw as { total_completed_amount?: number }).total_completed_amount ?? 0,
  );
  const loanEligibility = round2(savings * tierRow.loanMultiplier);

  return {
    financialScore:  round2(financial),
    socialScore:     round2(social),
    overallScore:    round2(overall),
    tier:            tierRow.tier,
    loanEligibility,
  };
}

async function computeComponents(
  client:   PoolClient,
  groupId:  string,
  memberId: string,
): Promise<Record<ComponentKey, ComponentScore>> {
  const [
    contribution,
    loan,
    savings,
    shareOwnership,
    dividend,
    meetingAttendance,
    welfareParticipation,
    leadership,
  ] = await Promise.all([
    componentContributionConsistency(client, groupId, memberId),
    componentLoanRepayment(client, groupId, memberId),
    componentSavingsGrowth(client, groupId, memberId),
    componentShareOwnership(client, groupId, memberId),
    componentDividendParticipation(client, groupId, memberId),
    componentMeetingAttendance(client, groupId, memberId),
    componentWelfareParticipation(client, groupId, memberId),
    componentLeadershipRole(client, groupId, memberId),
  ]);

  return {
    contribution_consistency: contribution,
    loan_repayment:           loan,
    savings_growth:           savings,
    share_ownership:          shareOwnership,
    dividend_participation:   dividend,
    meeting_attendance:       meetingAttendance,
    welfare_participation:    welfareParticipation,
    leadership_role:          leadership,
  };
}

/**
 * % of months in last 12 where the member had ≥1 completed contribution.
 * Also exports total_completed_amount for the loan-eligibility multiplier.
 */
async function componentContributionConsistency(
  client: PoolClient, groupId: string, memberId: string,
): Promise<ComponentScore> {
  const { rows } = await client.query<{
    months_with_contribution: string;
    total_completed_amount:   string;
  }>(
    `SELECT
       COUNT(DISTINCT DATE_TRUNC('month', contribution_date))::text AS months_with_contribution,
       COALESCE(SUM(amount), 0)::text                               AS total_completed_amount
     FROM contributions
     WHERE group_id = $1
       AND member_id = $2
       AND status = 'completed'
       AND contribution_date >= (CURRENT_DATE - INTERVAL '12 months')`,
    [groupId, memberId],
  );

  const months = parseInt(rows[0].months_with_contribution, 10);
  const totalAmount = Number(rows[0].total_completed_amount);
  const score = clamp((months / 12) * 100, 0, 100);

  return {
    score:  round2(score),
    weight: COMPONENT_WEIGHTS.contribution_consistency,
    raw:    {
      months_with_contribution: months,
      months_window: 12,
      total_completed_amount: totalAmount,
    },
  };
}

/**
 * Loan repayment timeliness — share of completed repayments paid on or before
 * due_date. Loans in 'defaulted' or 'written_off' status cap the score at 30
 * regardless. No loans ever → neutral 70 (don't punish people who never
 * borrowed).
 */
async function componentLoanRepayment(
  client: PoolClient, groupId: string, memberId: string,
): Promise<ComponentScore> {
  const [{ rows: rep }, { rows: loanStatus }] = await Promise.all([
    client.query<{
      on_time:  string;
      total:    string;
      paid_late: string;
    }>(
      `SELECT
         COUNT(*) FILTER (
           WHERE status = 'completed' AND payment_date IS NOT NULL AND payment_date <= due_date
         )::text AS on_time,
         COUNT(*) FILTER (
           WHERE status IN ('completed', 'overdue')
         )::text AS total,
         COUNT(*) FILTER (
           WHERE status = 'completed' AND payment_date IS NOT NULL AND payment_date >  due_date
         )::text AS paid_late
       FROM loan_repayments
       WHERE group_id = $1 AND member_id = $2`,
      [groupId, memberId],
    ),
    client.query<{
      defaulted:    string;
      written_off:  string;
      total_loans:  string;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'defaulted')::text   AS defaulted,
         COUNT(*) FILTER (WHERE status = 'written_off')::text AS written_off,
         COUNT(*)::text                                       AS total_loans
       FROM loans
       WHERE group_id = $1 AND member_id = $2`,
      [groupId, memberId],
    ),
  ]);

  const onTime    = parseInt(rep[0].on_time,    10);
  const total     = parseInt(rep[0].total,      10);
  const paidLate  = parseInt(rep[0].paid_late,  10);
  const defaulted = parseInt(loanStatus[0].defaulted,    10);
  const writtenOff = parseInt(loanStatus[0].written_off, 10);
  const totalLoans = parseInt(loanStatus[0].total_loans, 10);

  let score: number;
  if (totalLoans === 0) {
    // Never borrowed — neutral; don't penalise but don't reward either.
    score = 70;
  } else if (total === 0) {
    // Loan(s) exist but no scheduled repayments yet — neutral too.
    score = 70;
  } else {
    score = (onTime / total) * 100;
  }

  // Penalty: defaulted or written-off loans cap the score at 30.
  if (defaulted > 0 || writtenOff > 0) {
    score = Math.min(score, 30);
  }

  return {
    score:  round2(clamp(score, 0, 100)),
    weight: COMPONENT_WEIGHTS.loan_repayment,
    raw:    {
      repayments_on_time: onTime,
      repayments_total:   total,
      repayments_late:    paidLate,
      loans_total:        totalLoans,
      loans_defaulted:    defaulted,
      loans_written_off:  writtenOff,
    },
  };
}

/**
 * Savings growth — sum of completed contributions in last 12 months vs the
 * prior 12 months. Ratio of 1.0 (flat) ↦ 50; 2.0 (doubled) ↦ 100; 0 ↦ 0.
 * If there's no prior history but recent activity exists, score 70 (new
 * member growing).
 */
async function componentSavingsGrowth(
  client: PoolClient, groupId: string, memberId: string,
): Promise<ComponentScore> {
  const { rows } = await client.query<{
    recent_total: string;
    prior_total:  string;
  }>(
    `SELECT
       COALESCE(SUM(amount) FILTER (
         WHERE contribution_date >= (CURRENT_DATE - INTERVAL '12 months')
       ), 0)::text AS recent_total,
       COALESCE(SUM(amount) FILTER (
         WHERE contribution_date >= (CURRENT_DATE - INTERVAL '24 months')
           AND contribution_date <  (CURRENT_DATE - INTERVAL '12 months')
       ), 0)::text AS prior_total
     FROM contributions
     WHERE group_id = $1 AND member_id = $2 AND status = 'completed'`,
    [groupId, memberId],
  );

  const recent = Number(rows[0].recent_total);
  const prior  = Number(rows[0].prior_total);

  let score: number;
  let ratio: number | null = null;

  if (recent === 0 && prior === 0) {
    score = 0;
  } else if (prior === 0) {
    // Newly active member — give them the benefit of the doubt.
    score = 70;
  } else {
    ratio = recent / prior;
    score = clamp(ratio * 50, 0, 100);
  }

  return {
    score:  round2(score),
    weight: COMPONENT_WEIGHTS.savings_growth,
    raw:    {
      recent_12mo_total: recent,
      prior_12mo_total:  prior,
      growth_ratio:      ratio,
    },
  };
}

/**
 * Share ownership — percentile rank of member's total shares among all
 * shareholders in the group. Member with 0 shares scores 0; top holder
 * scores 100. Uses PERCENT_RANK over the population to avoid an N-row
 * round trip.
 */
async function componentShareOwnership(
  client: PoolClient, groupId: string, memberId: string,
): Promise<ComponentScore> {
  const { rows } = await client.query<{
    member_shares: string;
    total_shareholders: string;
    percent_rank: string | null;
  }>(
    `WITH totals AS (
       SELECT member_id,
              SUM(quantity) AS shares
         FROM share_holdings
        WHERE group_id = $1 AND quantity > 0
        GROUP BY member_id
     ), ranked AS (
       SELECT member_id, shares,
              PERCENT_RANK() OVER (ORDER BY shares) AS pr
         FROM totals
     )
     SELECT
       COALESCE((SELECT shares FROM ranked WHERE member_id = $2), 0)::text AS member_shares,
       COUNT(*)::text                                                       AS total_shareholders,
       (SELECT pr FROM ranked WHERE member_id = $2)::text                   AS percent_rank
     FROM ranked`,
    [groupId, memberId],
  );

  const memberShares = parseInt(rows[0]?.member_shares ?? '0', 10);
  const totalHolders = parseInt(rows[0]?.total_shareholders ?? '0', 10);
  const pr           = rows[0]?.percent_rank ? Number(rows[0].percent_rank) : null;

  let score: number;
  if (memberShares === 0) {
    score = 0;
  } else if (totalHolders <= 1) {
    // Sole shareholder — 100% by definition.
    score = 100;
  } else {
    // PERCENT_RANK is 0..1 ascending; convert to 0..100.
    score = (pr ?? 0) * 100;
  }

  return {
    score:  round2(clamp(score, 0, 100)),
    weight: COMPONENT_WEIGHTS.share_ownership,
    raw:    {
      member_shares:      memberShares,
      total_shareholders: totalHolders,
      percent_rank:       pr,
    },
  };
}

/**
 * Dividend participation — did the member actually receive a paid-out
 * dividend in the last 12 months? Binary 100/30. 30 (not 0) since
 * non-participation is usually a function of group policy more than the
 * member's behaviour.
 */
async function componentDividendParticipation(
  client: PoolClient, groupId: string, memberId: string,
): Promise<ComponentScore> {
  const { rows } = await client.query<{
    count: string;
    total: string;
  }>(
    `SELECT COUNT(*)::text             AS count,
            COALESCE(SUM(net_amount), 0)::text AS total
       FROM dividend_allocations
      WHERE group_id = $1 AND member_id = $2
        AND status = 'paid'
        AND paid_at >= (NOW() - INTERVAL '12 months')`,
    [groupId, memberId],
  );

  const count = parseInt(rows[0].count, 10);
  const total = Number(rows[0].total);

  const score = count > 0 ? 100 : 30;

  return {
    score,
    weight: COMPONENT_WEIGHTS.dividend_participation,
    raw:    {
      payouts_count: count,
      payouts_total: total,
    },
  };
}

// ─── Social components (E6.2) ──────────────────────────────────────────

/**
 * Meeting attendance — % of meetings in the last 12 months where the member
 * was marked 'present' or 'late'. Excused absences don't count as
 * participation but also don't penalise as harshly as plain absent.
 *
 * Score formula:
 *   attended = present + late
 *   relevant = present + late + absent   (excused excluded from denominator)
 *   score    = (attended / relevant) × 100
 *
 * If the group has had no meetings in 12mo OR the member was excused for
 * every meeting, score is a neutral 60 — we can't penalise someone for
 * something the group didn't host.
 */
async function componentMeetingAttendance(
  client: PoolClient, groupId: string, memberId: string,
): Promise<ComponentScore> {
  const { rows } = await client.query<{
    attended:        string;
    absent:          string;
    excused:         string;
    relevant_total:  string;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE ma.status IN ('present','late'))::text AS attended,
       COUNT(*) FILTER (WHERE ma.status = 'absent')::text            AS absent,
       COUNT(*) FILTER (WHERE ma.status = 'excused')::text           AS excused,
       COUNT(*) FILTER (WHERE ma.status IN ('present','late','absent'))::text AS relevant_total
     FROM meeting_attendance ma
     JOIN meetings m ON m.id = ma.meeting_id
     WHERE ma.group_id  = $1
       AND ma.member_id = $2
       AND m.scheduled_at >= (NOW() - INTERVAL '12 months')`,
    [groupId, memberId],
  );

  const attended    = parseInt(rows[0].attended,       10);
  const absent      = parseInt(rows[0].absent,         10);
  const excused     = parseInt(rows[0].excused,        10);
  const relevant    = parseInt(rows[0].relevant_total, 10);

  const score =
    relevant === 0
      ? 60                                          // no countable meetings → neutral
      : clamp((attended / relevant) * 100, 0, 100);

  return {
    score:  round2(score),
    weight: COMPONENT_WEIGHTS.meeting_attendance,
    raw:    {
      attended,
      absent,
      excused,
      relevant_meetings: relevant,
      window_months:     12,
    },
  };
}

/**
 * Welfare participation — has the member contributed to the welfare pool
 * in the last 12 months? Binary 100/40. 40 (not 0) because welfare giving
 * varies a lot by group culture and individual circumstance.
 */
async function componentWelfareParticipation(
  client: PoolClient, groupId: string, memberId: string,
): Promise<ComponentScore> {
  const { rows } = await client.query<{ count: string; total: string }>(
    `SELECT
       COUNT(*)::text                  AS count,
       COALESCE(SUM(amount), 0)::text  AS total
     FROM welfare_pool_contributions
     WHERE group_id  = $1
       AND member_id = $2
       AND created_at >= (NOW() - INTERVAL '12 months')`,
    [groupId, memberId],
  );

  const count = parseInt(rows[0].count, 10);
  const total = Number(rows[0].total);
  const score = count > 0 ? 100 : 40;

  return {
    score,
    weight: COMPONENT_WEIGHTS.welfare_participation,
    raw:    {
      contributions_count: count,
      contributions_total: total,
      window_months:       12,
    },
  };
}

/**
 * Leadership role — is the member currently holding an officer role?
 * Officers (chairperson / treasurer / secretary) get 100; regular members
 * get 50. We don't penalise non-officers because position is appointed,
 * not earned alone — but holding a role demonstrates active engagement.
 */
async function componentLeadershipRole(
  client: PoolClient, groupId: string, memberId: string,
): Promise<ComponentScore> {
  const { rows } = await client.query<{ role: string }>(
    `SELECT role FROM group_members
      WHERE group_id = $1 AND member_id = $2
      LIMIT 1`,
    [groupId, memberId],
  );

  const role = rows[0]?.role ?? 'member';
  const isOfficer = role === 'chairperson' || role === 'treasurer' || role === 'secretary';
  const score = isOfficer ? 100 : 50;

  return {
    score,
    weight: COMPONENT_WEIGHTS.leadership_role,
    raw:    {
      current_role: role,
      is_officer:   isOfficer,
    },
  };
}

// ─── Tiny helpers ───────────────────────────────────────────────────────

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function assertGroupMembership(client: PoolClient, groupId: string, memberId: string): Promise<void> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM group_members WHERE group_id = $1 AND member_id = $2`,
    [groupId, memberId],
  );
  if (!rows[0]) {
    throw new ValidationError(`Member ${memberId} is not in this group`);
  }
}

async function writeAuditLog(
  client: PoolClient,
  ctx:    TenantContext,
  action: string,
  resourceId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, new_values)
     VALUES ($1, $2, $3, 'credit_score', $4, $5::jsonb)`,
    [ctx.groupId, ctx.userId, action, resourceId, JSON.stringify(payload)],
  );
}
