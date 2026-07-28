/**
 * Governance/health-scoring engine (SUPER_ADMIN_PLATFORM_AUDIT.md §2.10,
 * Phase 2). Populates governance_snapshots/governance_health_scores/
 * governance_alerts from the 19 metrics + threshold bands already seeded
 * in governance_metrics/governance_thresholds (migrations 069/071/072) —
 * this file is the missing computation half; the schema and bands were
 * already fully designed, just never wired to anything.
 *
 * Data-source notes (why each metric reads what it reads):
 * - total_savings/gross_loans mirror member-balances.service.ts's
 *   established convention (raw contributions/loans sums, not the GL
 *   ledger) so this engine's numbers agree with what members/officers
 *   already see elsewhere in the app, not a second, disagreeing "truth".
 * - loan_growth is the one exception: loans.outstanding_balance has no
 *   historical "as of" notion (unlike accounts.balance, which is
 *   ledger-derived from journal_lines), so period-over-period loan growth
 *   reads account 1101 (Loans Receivable)'s ledger balance as-of both
 *   dates instead — the only way to get a genuinely historical figure.
 * - par30/npl/concentration/car/provision_coverage are inherently
 *   point-in-time operational reads (current loan.status, not
 *   retroactively derivable without a loan-status-history table, which
 *   doesn't exist) — always computed "as of now" regardless of the
 *   snapshot's nominal as_of date. Fine in practice since this job runs
 *   close to period-end.
 * - group_health is deliberately scoped to metrics with a real, verified
 *   data source (liquidity/credit/profitability/growth) — the seeded
 *   description also mentions "attendance" and "governance", for which no
 *   clean group-level aggregate exists yet; a documented gap, not silently
 *   dropped.
 */
import type { PoolClient } from 'pg';
import { withAdminDb } from '@/lib/db';
import { NotFoundError } from '@/lib/utils/errors';

// ─── Types ──────────────────────────────────────────────────────────────

type Rag = 'green' | 'amber' | 'red' | 'na';

interface ComputedMetric {
  code:        string;
  value:       number | null;
  numerator?:  number;
  denominator?: number;
}

export interface ThresholdRow {
  metric_code: string;
  green_min: string | null; green_max: string | null;
  amber_min: string | null; amber_max: string | null;
}

const HEALTH_SCORE_METRICS = [
  'liquidity_ratio', 'par30', 'npl', 'recovery_rate', 'oss', 'roa', 'savings_growth', 'membership_growth',
] as const;

// ─── Threshold resolution ───────────────────────────────────────────────

async function loadThresholds(client: PoolClient, groupId: string): Promise<Map<string, ThresholdRow>> {
  const { rows } = await client.query<ThresholdRow>(
    `SELECT DISTINCT ON (metric_code) metric_code, green_min, green_max, amber_min, amber_max
     FROM governance_thresholds
     WHERE (group_id = $1 OR group_id IS NULL) AND effective_from <= CURRENT_DATE
     ORDER BY metric_code, (group_id = $1) DESC, effective_from DESC`,
    [groupId],
  );
  return new Map(rows.map((r) => [r.metric_code, r]));
}

export function resolveRag(value: number | null, t: ThresholdRow | undefined): Rag {
  if (value === null || !t) return 'na';
  const inRange = (min: string | null, max: string | null) =>
    (min === null || value >= parseFloat(min)) && (max === null || value <= parseFloat(max));
  if (inRange(t.green_min, t.green_max)) return 'green';
  if (inRange(t.amber_min, t.amber_max)) return 'amber';
  return 'red';
}

// Maps a RAG band to a 0-100 contribution for the composite health score.
// 'na' contributes nothing (excluded from the average, not scored as 0 —
// a metric with no data shouldn't drag the score down).
const RAG_SCORE: Record<Rag, number | null> = { green: 100, amber: 55, red: 15, na: null };

// ─── Account balance / P&L helpers (mirror accounting.service.ts's own
// getBalanceSheet/getProfitAndLoss SQL exactly, but callable cross-tenant
// via a plain PoolClient rather than a single group's TenantContext) ─────

async function getAccountBalanceAsOf(client: PoolClient, groupId: string, accountCode: string, asOf: string): Promise<number> {
  const { rows } = await client.query<{ balance: string }>(
    `SELECT
       CASE WHEN a.type = 'asset'
         THEN COALESCE(SUM(jl.debit - jl.credit) FILTER (WHERE je.status = 'posted' AND je.entry_date <= $3), 0)
         ELSE -COALESCE(SUM(jl.debit - jl.credit) FILTER (WHERE je.status = 'posted' AND je.entry_date <= $3), 0)
       END::text AS balance
     FROM accounts a
     LEFT JOIN journal_lines jl ON jl.account_id = a.id AND jl.entry_date <= $3
     LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id
     WHERE a.group_id = $1 AND a.account_code = $2
     GROUP BY a.type`,
    [groupId, accountCode, asOf],
  );
  return rows[0] ? parseFloat(rows[0].balance) : 0;
}

/** Sum of ALL asset-type account ledger balances as-of a date — mirrors getBalanceSheet's own `assets` total exactly. */
async function getTotalAssetBalanceAsOf(client: PoolClient, groupId: string, asOf: string): Promise<number> {
  const { rows } = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM(jl.debit - jl.credit) FILTER (WHERE je.status = 'posted' AND je.entry_date <= $2), 0)::text AS total
     FROM accounts a
     LEFT JOIN journal_lines jl ON jl.account_id = a.id AND jl.entry_date <= $2
     LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id
     WHERE a.group_id = $1 AND a.type = 'asset' AND a.is_active = true
     GROUP BY a.id`,
    [groupId, asOf],
  );
  // One row per account (GROUP BY a.id) — sum them in JS.
  return rows.reduce((sum, r) => sum + parseFloat(r.total), 0);
}

async function getPnlTotals(client: PoolClient, groupId: string, from: string, to: string): Promise<{ income: number; expenses: number }> {
  const { rows } = await client.query<{ type: string; total: string }>(
    `SELECT a.type,
       CASE WHEN a.type = 'expense'
         THEN COALESCE(SUM(jl.debit)  FILTER (WHERE je.status = 'posted' AND je.entry_date BETWEEN $2 AND $3)
                     - SUM(jl.credit) FILTER (WHERE je.status = 'posted' AND je.entry_date BETWEEN $2 AND $3), 0)
         ELSE COALESCE(SUM(jl.credit) FILTER (WHERE je.status = 'posted' AND je.entry_date BETWEEN $2 AND $3)
                     - SUM(jl.debit)  FILTER (WHERE je.status = 'posted' AND je.entry_date BETWEEN $2 AND $3), 0)
       END::text AS total
     FROM accounts a
     LEFT JOIN journal_lines jl ON jl.account_id = a.id AND jl.entry_date BETWEEN $2 AND $3
     LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id
     WHERE a.group_id = $1 AND a.type IN ('income', 'expense') AND a.is_active = true
     GROUP BY a.type`,
    [groupId, from, to],
  );
  return {
    income:   parseFloat(rows.find((r) => r.type === 'income')?.total ?? '0'),
    expenses: parseFloat(rows.find((r) => r.type === 'expense')?.total ?? '0'),
  };
}

// ─── Base metrics (as-of a date where the source supports it) ───────────

async function getTotalSavings(client: PoolClient, groupId: string, asOf: string): Promise<number> {
  const [{ rows: sav }, { rows: out }] = await Promise.all([
    client.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS total FROM contributions
       WHERE group_id = $1 AND status = 'completed' AND contribution_date <= $2`,
      [groupId, asOf],
    ),
    client.query<{ total: string }>(
      `SELECT COALESCE(SUM(payout_amount), 0)::text AS total FROM cycle_shareouts
       WHERE group_id = $1 AND status = 'paid' AND paid_at <= $2`,
      [groupId, asOf],
    ),
  ]);
  return parseFloat(sav[0].total) - parseFloat(out[0].total);
}

async function getActiveMembers(client: PoolClient, groupId: string, asOf: string): Promise<number> {
  const { rows } = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM group_members WHERE group_id = $1 AND status = 'active' AND joined_at <= $2`,
    [groupId, asOf],
  );
  return parseInt(rows[0].count, 10);
}

/** Current (not as-of) gross loan portfolio — matches member-balances.service.ts's own convention. */
async function getGrossLoansNow(client: PoolClient, groupId: string): Promise<number> {
  const { rows } = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM(outstanding_balance), 0)::text AS total FROM loans
     WHERE group_id = $1 AND status IN ('active', 'disbursed')`,
    [groupId],
  );
  return parseFloat(rows[0].total);
}

interface LoanBuckets { current: number; par30: number; npl: number; concentrationTop10: number; }

async function getLoanBuckets(client: PoolClient, groupId: string): Promise<LoanBuckets> {
  const { rows } = await client.query<{
    current_bucket: string; par30_bucket: string; npl_bucket: string;
  }>(
    `SELECT
       COALESCE(SUM(outstanding_balance) FILTER (
         WHERE status IN ('active','disbursed')
           AND (next_payment_date IS NULL OR CURRENT_DATE - next_payment_date <= 30)
       ), 0)::text AS current_bucket,
       COALESCE(SUM(outstanding_balance) FILTER (
         WHERE status IN ('active','disbursed')
           AND next_payment_date IS NOT NULL AND CURRENT_DATE - next_payment_date > 30
       ), 0)::text AS par30_bucket,
       -- write-off zeroes outstanding_balance (loans.service.ts's writeOff()),
       -- so written_off loans contribute their principal instead; defaulted
       -- (not yet written off) loans still carry a real outstanding_balance.
       COALESCE(SUM(CASE WHEN status = 'written_off' THEN principal_amount ELSE outstanding_balance END)
         FILTER (WHERE status IN ('defaulted','written_off')), 0)::text AS npl_bucket
     FROM loans WHERE group_id = $1`,
    [groupId],
  );

  const { rows: top10 } = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM(outstanding_balance), 0)::text AS total FROM (
       SELECT outstanding_balance FROM loans
       WHERE group_id = $1 AND status IN ('active','disbursed')
       ORDER BY outstanding_balance DESC LIMIT 10
     ) top`,
    [groupId],
  );

  return {
    current: parseFloat(rows[0].current_bucket),
    par30:   parseFloat(rows[0].par30_bucket),
    npl:     parseFloat(rows[0].npl_bucket),
    concentrationTop10: parseFloat(top10[0].total),
  };
}

async function getRecoveryRate(client: PoolClient, groupId: string, asOf: string): Promise<{ paid: number; due: number }> {
  const { rows } = await client.query<{ paid: string; due: string }>(
    `SELECT COALESCE(SUM(amount_paid), 0)::text AS paid, COALESCE(SUM(total_due), 0)::text AS due
     FROM loan_repayments
     WHERE group_id = $1 AND due_date >= ($2::date - INTERVAL '12 months') AND due_date <= $2`,
    [groupId, asOf],
  );
  return { paid: parseFloat(rows[0].paid), due: parseFloat(rows[0].due) };
}

// ─── Risk-weighted assets (CAR) / provision & protection coverage ───────

async function getRiskWeights(client: PoolClient): Promise<Map<string, { riskWeight: number; provisionRate: number }>> {
  const { rows } = await client.query<{ asset_class: string; risk_weight: string; provision_rate: string }>(
    `SELECT DISTINCT ON (asset_class) asset_class, risk_weight, provision_rate
     FROM governance_risk_weights ORDER BY asset_class, effective_from DESC`,
  );
  return new Map(rows.map((r) => [r.asset_class, { riskWeight: parseFloat(r.risk_weight), provisionRate: parseFloat(r.provision_rate) }]));
}

// ─── Per-group computation ───────────────────────────────────────────────

export interface GroupGovernanceResult {
  groupId: string;
  healthScore: number | null;
  alertsRaised: number;
}

export async function computeGroupGovernanceSnapshot(
  client: PoolClient,
  groupId: string,
  asOf: string,
  riskWeights: Map<string, { riskWeight: number; provisionRate: number }>,
): Promise<GroupGovernanceResult> {
  const priorAsOf = new Date(asOf);
  priorAsOf.setMonth(priorAsOf.getMonth() - 1);
  const priorAsOfStr = priorAsOf.toISOString().slice(0, 10);

  const from12m = new Date(asOf); from12m.setFullYear(from12m.getFullYear() - 1);

  const [
    savings, priorSavings, activeMembers, priorActiveMembers, grossLoans, buckets, recovery,
    cash, bank, fixedAssets, loanLoss, protectionFund,
    memberSavingsAccount, equity1, equity2, pnl12m, totalAssets,
    loanGrowthNow, loanGrowthPrior,
  ] = await Promise.all([
    getTotalSavings(client, groupId, asOf),
    getTotalSavings(client, groupId, priorAsOfStr),
    getActiveMembers(client, groupId, asOf),
    getActiveMembers(client, groupId, priorAsOfStr),
    getGrossLoansNow(client, groupId),
    getLoanBuckets(client, groupId),
    getRecoveryRate(client, groupId, asOf),
    getAccountBalanceAsOf(client, groupId, '1001', asOf),
    getAccountBalanceAsOf(client, groupId, '1002', asOf),
    getAccountBalanceAsOf(client, groupId, '1201', asOf),
    getAccountBalanceAsOf(client, groupId, '1109', asOf),
    getAccountBalanceAsOf(client, groupId, '1003', asOf),
    getAccountBalanceAsOf(client, groupId, '2101', asOf),
    getAccountBalanceAsOf(client, groupId, '3001', asOf),
    getAccountBalanceAsOf(client, groupId, '3102', asOf),
    getPnlTotals(client, groupId, from12m.toISOString().slice(0, 10), asOf),
    getTotalAssetBalanceAsOf(client, groupId, asOf),
    getAccountBalanceAsOf(client, groupId, '1101', asOf),
    getAccountBalanceAsOf(client, groupId, '1101', priorAsOfStr),
  ]);

  const rwa =
    cash * (riskWeights.get('cash')?.riskWeight ?? 0) +
    bank * (riskWeights.get('bank')?.riskWeight ?? 0.2) +
    fixedAssets * (riskWeights.get('fixed_asset')?.riskWeight ?? 1.0) +
    buckets.current * (riskWeights.get('loan_active')?.riskWeight ?? 1.0) +
    buckets.par30 * (riskWeights.get('loan_par30')?.riskWeight ?? 1.0) +
    buckets.npl * (riskWeights.get('loan_npl')?.riskWeight ?? 1.5);

  const institutionalCapital = equity1 + equity2; // Member Equity + Statutory Reserve

  const pct = (num: number, den: number): number | null => (den > 0 ? (num / den) * 100 : null);
  const growth = (curr: number, prior: number): number | null => (prior > 0 ? ((curr - prior) / prior) * 100 : null);

  // memberSavingsAccount (2101, a liability) already comes back as a
  // positive human-readable balance from getAccountBalanceAsOf's own
  // sign convention (liabilities negated internally) — use it directly,
  // do not re-negate it.
  const metrics: ComputedMetric[] = [
    { code: 'liquidity_ratio',    value: pct(cash + bank, memberSavingsAccount) },
    { code: 'ldr',                value: pct(grossLoans, memberSavingsAccount) },
    { code: 'par30',              value: pct(buckets.par30, grossLoans), numerator: buckets.par30, denominator: grossLoans },
    { code: 'npl',                value: pct(buckets.npl, grossLoans + buckets.npl), numerator: buckets.npl, denominator: grossLoans + buckets.npl },
    { code: 'recovery_rate',      value: pct(recovery.paid, recovery.due), numerator: recovery.paid, denominator: recovery.due },
    { code: 'concentration',      value: pct(buckets.concentrationTop10, grossLoans) },
    { code: 'oss',                value: pct(pnl12m.income, pnl12m.expenses) },
    { code: 'cost_to_income',     value: pct(pnl12m.expenses, pnl12m.income) },
    { code: 'roa',                value: pct(pnl12m.income - pnl12m.expenses, totalAssets) },
    { code: 'roe',                value: pct(pnl12m.income - pnl12m.expenses, institutionalCapital) },
    { code: 'savings_growth',     value: growth(savings, priorSavings) },
    { code: 'membership_growth',  value: growth(activeMembers, priorActiveMembers) },
    { code: 'loan_growth',        value: growth(loanGrowthNow, loanGrowthPrior) },
    { code: 'total_savings',      value: savings },
    { code: 'gross_loans',        value: grossLoans },
    { code: 'active_members',     value: activeMembers },
    { code: 'total_assets',       value: totalAssets },
    { code: 'car',                value: pct(institutionalCapital, rwa) },
    { code: 'provision_coverage', value: pct(loanLoss, buckets.npl) },
    { code: 'savings_protection', value: pct(protectionFund, memberSavingsAccount) },
  ];

  const thresholds = await loadThresholds(client, groupId);

  // Prior snapshot values, for trend ('up'/'down'/'flat').
  const { rows: priorRows } = await client.query<{ metric_code: string; value: string | null }>(
    `SELECT metric_code, value FROM governance_snapshots
     WHERE group_id = $1 AND as_of = $2 AND period_type = 'monthly'`,
    [groupId, priorAsOfStr],
  );
  const priorByCode = new Map(priorRows.map((r) => [r.metric_code, r.value !== null ? parseFloat(r.value) : null]));

  let alertsRaised = 0;
  const ragForHealthScore: Rag[] = [];

  for (const m of metrics) {
    const t = thresholds.get(m.code);
    const rag = resolveRag(m.value, t);
    const prior = priorByCode.get(m.code) ?? null;
    const trend = m.value === null || prior === null ? null
      : m.value > prior ? 'up' : m.value < prior ? 'down' : 'flat';

    await client.query(
      `INSERT INTO governance_snapshots (group_id, as_of, period_type, metric_code, value, numerator, denominator, rag, prior_value, trend)
       VALUES ($1, $2, 'monthly', $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (group_id, as_of, period_type, metric_code) DO UPDATE SET
         value = EXCLUDED.value, numerator = EXCLUDED.numerator, denominator = EXCLUDED.denominator,
         rag = EXCLUDED.rag, prior_value = EXCLUDED.prior_value, trend = EXCLUDED.trend, computed_at = NOW()`,
      [groupId, asOf, m.code, m.value, m.numerator ?? null, m.denominator ?? null, rag, prior, trend],
    );

    if ((HEALTH_SCORE_METRICS as readonly string[]).includes(m.code)) ragForHealthScore.push(rag);

    if (rag === 'amber' || rag === 'red') {
      const dedupKey = `${groupId}:${m.code}:${asOf}:monthly`;
      const severity = rag === 'red' ? 'red' : 'amber';
      const { rowCount } = await client.query(
        `INSERT INTO governance_alerts (group_id, metric_code, as_of, period_type, severity, value, message, dedup_key)
         VALUES ($1, $2, $3, 'monthly', $4, $5, $6, $7)
         ON CONFLICT (dedup_key) DO NOTHING`,
        [groupId, m.code, asOf, severity, m.value, `${m.code} is ${severity} (${m.value?.toFixed(1) ?? 'n/a'})`, dedupKey],
      );
      alertsRaised += rowCount ?? 0;
    }
  }

  // Composite health score: average of the RAG_SCORE for the scoped metric
  // set, excluding any that came back 'na' (no data yet for this group).
  const scored = ragForHealthScore.map((r) => RAG_SCORE[r]).filter((v): v is number => v !== null);
  const healthScore = scored.length > 0 ? Math.round(scored.reduce((s, v) => s + v, 0) / scored.length) : null;

  if (healthScore !== null) {
    const healthT = thresholds.get('group_health');
    const healthRag = resolveRag(healthScore, healthT);
    await client.query(
      `INSERT INTO governance_snapshots (group_id, as_of, period_type, metric_code, value, rag)
       VALUES ($1, $2, 'monthly', 'group_health', $3, $4)
       ON CONFLICT (group_id, as_of, period_type, metric_code) DO UPDATE SET value = EXCLUDED.value, rag = EXCLUDED.rag, computed_at = NOW()`,
      [groupId, asOf, healthScore, healthRag],
    );
    await client.query(
      `INSERT INTO governance_health_scores (group_id, as_of, period_type, score, category, components)
       VALUES ($1, $2, 'monthly', $3, $4, $5)
       ON CONFLICT (group_id, as_of, period_type) DO UPDATE SET score = EXCLUDED.score, category = EXCLUDED.category, components = EXCLUDED.components, computed_at = NOW()`,
      [groupId, asOf, healthScore, healthRag, JSON.stringify(Object.fromEntries(metrics.filter((m) => HEALTH_SCORE_METRICS.includes(m.code as never)).map((m) => [m.code, m.value])))],
    );
  }

  return { groupId, healthScore, alertsRaised };
}

/**
 * Iterates every active group, computing and persisting its governance
 * snapshot for `asOf`. Each group runs in its OWN withAdminDb transaction
 * (not one shared transaction for the whole platform loop) — a genuine
 * SQL-level error inside one group's computation would otherwise poison a
 * single shared Postgres transaction, cascading failures to every group
 * after it despite the per-group try/catch, defeating the whole point of
 * isolating tenant failures. Mirrors sendAllGroupMemberStatements's own
 * shape (a plain JS loop over groups, each iteration's DB work in its own
 * withAdminDb call), not a single big transaction with a loop inside it.
 */
export async function computeGovernanceForAllGroups(asOf: string): Promise<{ groups: number; succeeded: number; failed: number; alertsRaised: number }> {
  const { rows: groups } = await withAdminDb((client) => client.query<{ id: string }>(`SELECT id FROM groups WHERE is_active = true`));
  const riskWeights = await withAdminDb((client) => getRiskWeights(client));

  let succeeded = 0, failed = 0, alertsRaised = 0;
  for (const group of groups) {
    try {
      const result = await withAdminDb((client) => computeGroupGovernanceSnapshot(client, group.id, asOf, riskWeights));
      succeeded++;
      alertsRaised += result.alertsRaised;
    } catch {
      failed++;
    }
  }
  return { groups: groups.length, succeeded, failed, alertsRaised };
}

// ─────────────────────────────────────────────────────────────────────────────
// Alert workflow — mirrors updateTicketStatus's exact shape (admin.service.ts),
// the closest existing ack/resolve-style precedent in this codebase.
// ─────────────────────────────────────────────────────────────────────────────

export async function listGovernanceAlerts(params: {
  page: number; limit: number; status?: string; severity?: string; groupId?: string;
}) {
  return withAdminDb(async (db: PoolClient) => {
    const { page, limit, status, severity, groupId } = params;
    const offset = (page - 1) * limit;
    const conds: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;

    if (status)   { conds.push(`a.status = $${idx}`);      vals.push(status);   idx++; }
    if (severity) { conds.push(`a.severity = $${idx}`);    vals.push(severity); idx++; }
    if (groupId)  { conds.push(`a.group_id = $${idx}`);    vals.push(groupId);  idx++; }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const [data, count] = await Promise.all([
      db.query(`
        SELECT a.*, g.name AS group_name, gm.name AS metric_name,
               ack.first_name || ' ' || ack.last_name AS acknowledged_by_name
        FROM public.governance_alerts a
        JOIN public.groups g ON g.id = a.group_id
        JOIN public.governance_metrics gm ON gm.code = a.metric_code
        LEFT JOIN public.members ack ON ack.id = a.acknowledged_by
        ${where}
        ORDER BY CASE a.severity WHEN 'red' THEN 1 ELSE 2 END, a.created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `, [...vals, limit, offset]),
      db.query(`SELECT COUNT(*) AS total FROM public.governance_alerts a ${where}`, vals),
    ]);

    return { items: data.rows, total: parseInt(count.rows[0].total, 10), page, limit };
  });
}

export async function acknowledgeAlert(alertId: string, adminId: string) {
  return withAdminDb(async (db: PoolClient) => {
    const { rowCount } = await db.query(
      `UPDATE public.governance_alerts
       SET status = 'acknowledged', acknowledged_by = $2, acknowledged_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'open'`,
      [alertId, adminId],
    );
    if (!rowCount) throw new NotFoundError('Open governance alert', alertId);
    return { success: true };
  });
}

export async function resolveAlert(alertId: string, adminId: string) {
  return withAdminDb(async (db: PoolClient) => {
    const { rowCount } = await db.query(
      `UPDATE public.governance_alerts
       SET status = 'resolved', acknowledged_by = COALESCE(acknowledged_by, $2),
           acknowledged_at = COALESCE(acknowledged_at, NOW()), updated_at = NOW()
       WHERE id = $1 AND status != 'resolved'`,
      [alertId, adminId],
    );
    if (!rowCount) throw new NotFoundError('Governance alert', alertId);
    return { success: true };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot reads — power the group detail health card and the Risk Center
// heatmap. Read-only, no computation; purely reshapes what
// computeGroupGovernanceSnapshot already persisted.
// ─────────────────────────────────────────────────────────────────────────────

export async function getGroupGovernanceSnapshot(groupId: string) {
  return withAdminDb(async (db: PoolClient) => {
    const { rows: latest } = await db.query<{ as_of: string | null }>(
      `SELECT MAX(as_of)::text AS as_of FROM governance_snapshots WHERE group_id = $1`,
      [groupId],
    );
    const asOf = latest[0]?.as_of ?? null;
    if (!asOf) return { asOf: null, metrics: [], healthScore: null };

    const [{ rows: metrics }, { rows: health }] = await Promise.all([
      db.query(
        `SELECT s.metric_code, gm.name AS metric_name, gm.category, gm.unit, s.value, s.rag, s.trend
         FROM governance_snapshots s
         JOIN governance_metrics gm ON gm.code = s.metric_code
         WHERE s.group_id = $1 AND s.as_of = $2 AND s.period_type = 'monthly'
         ORDER BY gm.sort_order`,
        [groupId, asOf],
      ),
      db.query(
        `SELECT score, category AS rag, components FROM governance_health_scores
         WHERE group_id = $1 AND as_of = $2 AND period_type = 'monthly'`,
        [groupId, asOf],
      ),
    ]);
    return { asOf, metrics, healthScore: health[0] ?? null };
  });
}
