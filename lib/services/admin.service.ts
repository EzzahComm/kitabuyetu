import { withAdminDb } from '@/lib/db';
import { DatabaseError, type PoolClient } from 'pg';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/utils/errors';
import { DEFAULT_PRODUCT, type SubscriptionProduct } from '@/types/enums';
import { cached, keys } from '@/lib/redis';
import { computeMemberFinancialSnapshot } from './member-balances.service';
import { assertActiveMembership } from './membership-guard';
import { postContributionJournal } from './accounting.service';
import { IS_SANDBOX, markSpineAllocated } from './mpesa-spine.service';

export interface RiskDashboardPayload {
  summary: {
    openAlerts: number;
    flaggedVolume: number;
    pendingKyc: number;
    platformRisk: string;
  };
  heatmap: Array<{ segment: string; scores: number[] }>;
  alerts: Array<{
    id: string;
    org: string;
    type: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    amount: number;
    detail: string;
    ago: number;
    status: 'open' | 'reviewing';
  }>;
  kyc: Array<{
    id: string;
    name: string;
    org: string;
    docType: string;
    submitted: string;
    risk: 'low' | 'medium' | 'high';
  }>;
  alertTrend: Array<{ day: string; alerts: number; resolved: number }>;
}

export interface MonitoringDashboardPayload {
  services: Array<{
    id: string;
    name: string;
    group: 'M-Pesa / Daraja' | 'Messaging' | 'Platform';
    status: 'operational' | 'degraded' | 'down';
    latency: number;
    success: number;
    note: string;
  }>;
  hourlyVolume: Array<{ hour: string; count: number; value: number }>;
  smsUsage: {
    sentToday: number;
    delivered: number;
    failed: number;
    pending: number;
    creditsRemaining: number;
    creditsTotal: number;
  };
  transactions: Array<{
    id: string;
    type: 'C2B' | 'B2C' | 'STK';
    org: string;
    phone: string;
    amount: number;
    status: 'success' | 'pending' | 'failed';
    ref: string;
    at: number;
  }>;
}

export function buildRiskDashboardPayload(input: {
  groups: Array<{
    id: string;
    name: string;
    group_type?: string | null;
    risk_score?: number | null;
    engagement_score?: number | null;
    onboarding_status?: string | null;
    created_at?: string | null;
    admin_name?: string | null;
  }>;
  transactions: Array<{
    id: string;
    amount: string | number | null;
    status: string | null;
    created_at: string | null;
    transaction_type: string | null;
    failure_reason: string | null;
    description: string | null;
  }>;
  dailyTrend: Array<{ day: string; alerts: number; resolved: number }>;
  heatmap: Array<{ segment: string; scores: number[] }>;
}): RiskDashboardPayload {
  const alerts: RiskDashboardPayload['alerts'] = input.transactions
    .filter((tx) => tx.status === 'failed' || tx.status === 'pending')
    .slice(0, 6)
    .map((tx, index) => ({
      id: tx.id,
      org: input.groups[index % input.groups.length]?.name ?? 'Platform activity',
      type: tx.failure_reason ? tx.failure_reason : 'Risk signal',
      severity: index === 0 ? 'critical' : index === 1 ? 'high' : index === 2 ? 'medium' : 'low',
      amount: Number(tx.amount ?? 0),
      detail: tx.description ?? 'Detected during automated monitoring',
      ago: Math.max(1, 5 + index * 8),
      status: 'open',
    }));

  const pendingKyc = input.groups.filter((g) => g.onboarding_status !== 'active').length;
  const highRiskGroups = input.groups.filter((g) => (g.risk_score ?? 0) >= 60).length;
  const kycQueue: RiskDashboardPayload['kyc'] = [...input.groups]
    .sort((a, b) => {
      const aPending = a.onboarding_status !== 'active';
      const bPending = b.onboarding_status !== 'active';
      if (aPending !== bPending) return aPending ? -1 : 1;
      return (b.risk_score ?? 0) - (a.risk_score ?? 0);
    })
    .map((g, index) => ({
      id: `KYC-${g.id}`,
      name: g.admin_name ?? 'Pending review',
      org: g.name,
      docType: g.group_type === 'sacco' ? 'National ID' : 'Passport',
      submitted: `${index + 1} hr ago`,
      risk: g.onboarding_status !== 'active' ? 'medium' : (g.risk_score ?? 0) >= 60 ? 'high' : (g.risk_score ?? 0) >= 35 ? 'medium' : 'low',
    }));

  return {
    summary: {
      openAlerts: alerts.filter((a) => a.status === 'open').length,
      flaggedVolume: alerts.reduce((sum, a) => sum + a.amount, 0),
      pendingKyc,
      platformRisk: highRiskGroups > 0 ? 'Elevated' : 'Moderate',
    },
    heatmap: input.heatmap?.length
      ? input.heatmap
      : [{ segment: 'All groups', scores: [0, 0, 0, 0, 0] }],
    alerts,
    kyc: kycQueue,
    alertTrend: input.dailyTrend.length ? input.dailyTrend : [{ day: 'Today', alerts: 0, resolved: 0 }],
  };
}

export function buildMonitoringDashboardPayload(input: {
  services: Array<{
    id: string;
    name: string;
    group: 'M-Pesa / Daraja' | 'Messaging' | 'Platform';
    status: 'operational' | 'degraded' | 'down';
    latency: number;
    success: number;
    note: string;
  }>;
  hourlyVolume: Array<{ hour: string; count: number; value: number }>;
  smsUsage: {
    sentToday: number;
    delivered: number;
    failed: number;
    pending: number;
    creditsRemaining: number;
    creditsTotal: number;
  };
  transactions: Array<{
    id: string;
    transaction_type: string | null;
    phone_number: string | null;
    amount: string | number | null;
    status: string | null;
    mpesa_receipt_number: string | null;
    reference: string | null;
    created_at: string | null;
  }>;
}): MonitoringDashboardPayload {
  return {
    services: input.services,
    hourlyVolume: input.hourlyVolume,
    smsUsage: input.smsUsage,
    transactions: input.transactions.map((tx) => ({
      id: tx.id,
      // DB values are 'stk_push' / 'c2b' / 'b2c' (+ others filtered out at the
      // query). Normalize to the three feed badges; anything unexpected renders
      // as C2B rather than crashing the page on an unknown key.
      type: ((t: string) =>
        t.includes('stk') ? 'STK' : t.includes('b2c') ? 'B2C' : 'C2B'
      )((tx.transaction_type ?? '').toLowerCase()) as 'C2B' | 'B2C' | 'STK',
      org: 'Platform activity',
      phone: tx.phone_number ?? '',
      amount: Number(tx.amount ?? 0),
      status: (tx.status === 'failed' ? 'failed' : tx.status === 'pending' ? 'pending' : 'success') as 'success' | 'pending' | 'failed',
      ref: tx.mpesa_receipt_number ?? tx.reference ?? tx.id,
      at: Date.parse(tx.created_at ?? new Date().toISOString()),
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Platform dashboard stats
// ─────────────────────────────────────────────────────────────────────────────
export async function getPlatformStats() {
  return cached(keys.cache('platform-stats', 'platform'), 90, () => withAdminDb(async (db: PoolClient) => {
    const [groups, organizations, members, subscriptions, revenue, tickets, activity] = await Promise.all([
      db.query(`
        SELECT
          COUNT(*)                                              AS total,
          COUNT(*) FILTER (WHERE onboarding_status = 'active') AS active,
          COUNT(*) FILTER (WHERE onboarding_status = 'suspended') AS suspended,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS new_this_month
        FROM public.groups
      `),
      db.query(`
        SELECT
          COUNT(*)                                  AS total,
          COUNT(*) FILTER (WHERE is_active = true)  AS active,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS new_this_month
        FROM public.organizations
      `),
      db.query(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE is_active = true) AS active,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS new_this_month
        FROM public.members
      `),
      db.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'active')     AS active_subscriptions,
          COUNT(*) FILTER (WHERE status = 'expired')    AS expired_subscriptions,
          COUNT(*) FILTER (WHERE status = 'suspended')  AS suspended_subscriptions,
          COUNT(*) FILTER (WHERE status = 'expired' OR status = 'suspended') AS at_risk,
          COALESCE(SUM(monthly_fee) FILTER (WHERE status = 'active'), 0) AS mrr,
          COUNT(*) FILTER (WHERE expires_at < NOW() AND status = 'active') AS overdue_count
        FROM public.subscriptions
      `),
      db.query(`
        SELECT
          COALESCE(SUM(amount), 0) AS total_collected,
          COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN amount ELSE 0 END), 0) AS this_month,
          COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '7 days'  THEN amount ELSE 0 END), 0) AS this_week
        FROM public.payments
        WHERE status = 'completed'
      `),
      db.query(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status = 'open')        AS open,
          COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
          COUNT(*) FILTER (WHERE sla_breach_at < NOW() AND status NOT IN ('resolved','closed')) AS sla_breached
        FROM public.support_tickets
      `),
      db.query(`
        SELECT
          al.action, al.resource_type AS table_name, al.created_at,
          g.name AS group_name
        FROM public.audit_logs al
        LEFT JOIN public.groups g ON g.id = al.group_id
        ORDER BY al.created_at DESC
        LIMIT 10
      `),
    ]);

    return {
      groups:        groups.rows[0],
      organizations: organizations.rows[0],
      members:       members.rows[0],
      subscriptions: subscriptions.rows[0],
      revenue:       revenue.rows[0],
      tickets:       tickets.rows[0],
      recentActivity: activity.rows,
    };
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Revenue trend (last 6 months)
// ─────────────────────────────────────────────────────────────────────────────
export async function getRevenueTrend() {
  return cached(keys.cache('revenue-trend', 'platform'), 120, () => withAdminDb(async (db: PoolClient) => {
    const { rows } = await db.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'Mon YYYY') AS month,
        DATE_TRUNC('month', created_at)                       AS month_date,
        COALESCE(SUM(amount), 0)                             AS revenue,
        COUNT(*)                                              AS transactions
      FROM public.payments
      WHERE status = 'completed'
        AND created_at >= NOW() - INTERVAL '6 months'
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month_date ASC
    `);
    return rows;
  }));
}

export async function getRiskDashboardData(): Promise<RiskDashboardPayload> {
  return cached(keys.cache('risk-dashboard', 'platform'), 60, () => withAdminDb(async (db: PoolClient) => {
    const [groups, transactions, trend, heatmap] = await Promise.all([
      db.query(`
        SELECT g.id, g.name, g.type AS group_type, g.risk_score, g.engagement_score, g.onboarding_status, g.created_at,
               m.first_name || ' ' || m.last_name AS admin_name
        FROM public.groups g
        LEFT JOIN public.group_members gm ON gm.group_id = g.id AND gm.role = 'chairperson'
        LEFT JOIN public.members m ON m.id = gm.member_id
        ORDER BY g.created_at DESC
        LIMIT 12
      `),
      db.query(`
        SELECT id, amount, status, created_at, transaction_type, failure_reason, description
        FROM public.mpesa_transactions
        ORDER BY created_at DESC
        LIMIT 12
      `),
      db.query(`
        SELECT TO_CHAR(d.day, 'Dy') AS day,
               COUNT(t.id) FILTER (WHERE t.status IN ('failed','pending'))     AS alerts,
               COUNT(t.id) FILTER (WHERE t.status NOT IN ('failed','pending')) AS resolved
        FROM generate_series((CURRENT_DATE - INTERVAL '6 days')::date, CURRENT_DATE::date, INTERVAL '1 day') d(day)
        LEFT JOIN public.mpesa_transactions t ON t.created_at::date = d.day
        GROUP BY d.day
        ORDER BY d.day
      `),
      db.query(`
        WITH txn AS (
          SELECT g.type::text AS segment,
                 COUNT(*) AS total,
                 COUNT(*) FILTER (WHERE t.status IN ('failed','pending')) AS risky
          FROM public.mpesa_transactions t
          JOIN public.groups g ON g.id = t.group_id
          GROUP BY g.type
        ),
        -- Real per-category "badness" (100 - goodness), sourced from each
        -- group's latest governance_snapshots RAG rather than the dead
        -- groups.risk_score column or the stale loans.days_in_arrears
        -- column. Same green=100/amber=55/red=15 mapping the composite
        -- health score uses (governance.service.ts's RAG_SCORE).
        gov AS (
          SELECT g.type::text AS segment, gm.category,
                 AVG(CASE s.rag WHEN 'green' THEN 100 WHEN 'amber' THEN 55 WHEN 'red' THEN 15 END) AS goodness
          FROM public.governance_snapshots s
          JOIN public.governance_metrics gm ON gm.code = s.metric_code
          JOIN public.groups g ON g.id = s.group_id
          JOIN (
            SELECT group_id, MAX(as_of) AS as_of FROM public.governance_snapshots GROUP BY group_id
          ) latest ON latest.group_id = s.group_id AND latest.as_of = s.as_of
          WHERE gm.category IN ('liquidity', 'credit', 'capital') AND s.period_type = 'monthly' AND s.rag <> 'na'
          GROUP BY g.type, gm.category
        )
        SELECT g.type::text AS segment,
               ROUND(100.0 * COALESCE(MAX(txn.risky), 0) / NULLIF(MAX(txn.total), 0))::int AS fraud,
               ROUND(100 - COALESCE(MAX(gov.goodness) FILTER (WHERE gov.category = 'capital'), 100))::int   AS capital,
               ROUND(100 - COALESCE(MAX(gov.goodness) FILTER (WHERE gov.category = 'credit'), 100))::int    AS credit,
               ROUND(100 - COALESCE(MAX(gov.goodness) FILTER (WHERE gov.category = 'liquidity'), 100))::int AS liquidity,
               ROUND(100.0 * COUNT(*) FILTER (WHERE g.kyc_verified_at IS NULL) / NULLIF(COUNT(*), 0))::int AS compliance
        FROM public.groups g
        LEFT JOIN txn ON txn.segment = g.type::text
        LEFT JOIN gov ON gov.segment = g.type::text
        GROUP BY g.type
        ORDER BY g.type
      `),
    ]);

    const prettySegment = (s: string) =>
      s === 'sacco' ? 'SACCOs'
      : s === 'chama' ? 'Chamas'
      : s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') + 's';

    return buildRiskDashboardPayload({
      groups: groups.rows,
      transactions: transactions.rows,
      dailyTrend: trend.rows,
      heatmap: heatmap.rows.map((r: Record<string, unknown>) => ({
        segment: prettySegment(String(r.segment)),
        scores: [r.fraud, r.capital, r.credit, r.liquidity, r.compliance].map((n) => Number(n ?? 0)),
      })),
    });
  }));
}

export async function getMonitoringDashboardData(): Promise<MonitoringDashboardPayload> {
  return cached(keys.cache('monitoring-dashboard', 'platform'), 20, () => withAdminDb(async (db: PoolClient) => {
    const [channels, smsHealth, hourly, smsUsage, transactions, stuckCallbacks] = await Promise.all([
      // Per-channel M-Pesa health from real transactions (last 24h): success
      // rate + average round-trip latency (completed_at − initiated_at).
      db.query(`
        SELECT transaction_type,
               COUNT(*)                                                 AS total,
               COUNT(*) FILTER (WHERE status NOT IN ('failed','pending')) AS ok,
               COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - initiated_at)) * 1000)
                 FILTER (WHERE completed_at IS NOT NULL AND initiated_at IS NOT NULL)), 0)::int AS latency_ms
        FROM public.mpesa_transactions
        WHERE created_at >= NOW() - INTERVAL '24 hours'
        GROUP BY transaction_type
      `),
      db.query(`
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE status IN ('sent','delivered')) AS ok
        FROM public.sms_usage_logs
        WHERE created_at >= NOW() - INTERVAL '24 hours'
      `),
      // Today's transaction volume by hour (real).
      db.query(`
        SELECT TO_CHAR(DATE_TRUNC('hour', created_at), 'HH24:00') AS hour,
               COUNT(*) AS count, COALESCE(SUM(amount), 0) AS value
        FROM public.mpesa_transactions
        WHERE created_at >= CURRENT_DATE
        GROUP BY DATE_TRUNC('hour', created_at)
        ORDER BY DATE_TRUNC('hour', created_at)
      `),
      db.query(`
        SELECT COALESCE(SUM(CASE WHEN status = 'sent' OR status = 'delivered' THEN 1 ELSE 0 END), 0) AS delivered,
               COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
               COALESCE(SUM(CASE WHEN status = 'queued' OR status = 'sent' THEN 1 ELSE 0 END), 0) AS pending,
               COUNT(*) AS sent_today,
               (SELECT COALESCE(SUM(sms_credits), 0) FROM public.billing_accounts) AS credits_remaining
        FROM public.sms_usage_logs
        WHERE created_at >= CURRENT_DATE
      `),
      db.query(`
        SELECT id, transaction_type, phone_number, amount, status, mpesa_receipt_number, reference, created_at
        FROM public.mpesa_transactions
        WHERE transaction_type IN ('c2b', 'b2c', 'stk_push')
        ORDER BY created_at DESC
        LIMIT 12
      `),
      // Callbacks the DLQ replay (mpesa_replay_callbacks, every 5 min) has had
      // many chances at and is still failing — a real signal something is
      // structurally broken (e.g. a schema/code mismatch), not just transient
      // provider flakiness. This is the "surfaced for administrator action"
      // half of the retry story; replay itself already exists and is
      // idempotent (lib/services/mpesa-callbacks.service.ts).
      db.query(`
        SELECT COUNT(*) AS stuck
        FROM public.mpesa_callbacks
        WHERE processed = false
          AND callback_type IN ('stk_push','c2b_confirmation')
          AND created_at < NOW() - INTERVAL '30 minutes'
      `),
    ]);

    // ── Build real service-health rows from the channel aggregates ──────
    type SvcStatus = 'operational' | 'degraded' | 'down';
    const statusFor = (successPct: number, total: number): SvcStatus =>
      total === 0 ? 'operational' : successPct >= 98 ? 'operational' : successPct >= 90 ? 'degraded' : 'down';

    const chanRows = channels.rows as Array<{ transaction_type: string | null; total: string; ok: string; latency_ms: number }>;
    const chan = (k: string) => chanRows.find((r) => (r.transaction_type ?? '').toLowerCase().includes(k));

    const mpesaChannels: Array<{ id: string; name: string; key: string }> = [
      { id: 'c2b', name: 'Daraja C2B (Paybill/Till)', key: 'c2b' },
      { id: 'b2c', name: 'Daraja B2C (Disbursements)', key: 'b2c' },
      { id: 'stk', name: 'STK Push (Express)', key: 'stk' },
    ];

    const services: MonitoringDashboardPayload['services'] = mpesaChannels.map((c) => {
      const row = chan(c.key);
      const total = Number(row?.total ?? 0);
      const ok = Number(row?.ok ?? 0);
      const success = total ? (ok / total) * 100 : 100;
      return {
        id: c.id, name: c.name, group: 'M-Pesa / Daraja' as const,
        status: statusFor(success, total),
        latency: Number(row?.latency_ms ?? 0),
        success: Math.round(success * 10) / 10,
        note: total ? `${total} txns in last 24h` : 'No traffic in last 24h',
      };
    });

    const smsRow = smsHealth.rows[0] ?? {};
    const smsTotal = Number(smsRow.total ?? 0);
    const smsSuccess = smsTotal ? (Number(smsRow.ok ?? 0) / smsTotal) * 100 : 100;
    services.push({
      id: 'sms', name: 'SMS Gateway', group: 'Messaging' as const,
      status: statusFor(smsSuccess, smsTotal),
      latency: 0,
      success: Math.round(smsSuccess * 10) / 10,
      note: smsTotal ? `${smsTotal} sent in last 24h` : 'No SMS in last 24h',
    });

    const stuck = Number(stuckCallbacks.rows[0]?.stuck ?? 0);
    services.push({
      id: 'mpesa-callback-dlq', name: 'Callback Processing (DLQ)', group: 'M-Pesa / Daraja' as const,
      status: stuck === 0 ? 'operational' : stuck >= 5 ? 'down' : 'degraded',
      latency: 0,
      success: stuck === 0 ? 100 : 0,
      note: stuck === 0
        ? 'No callbacks stuck after retry'
        : `${stuck} callback${stuck === 1 ? '' : 's'} unprocessed after 30+ min of retries — needs investigation`,
    });

    const sms = smsUsage.rows[0] ?? {};
    // Real balance from billing_accounts (the table SMS top-ups credit and
    // sends debit). "Total" = what the platform started today with, so the
    // usage bar reflects today's actual burn — no invented pool size.
    const creditsRemaining = Math.max(0, Number(sms.credits_remaining ?? 0));
    const sentToday        = Number(sms.sent_today ?? 0);

    return buildMonitoringDashboardPayload({
      services,
      hourlyVolume: hourly.rows.map((r: Record<string, unknown>) => ({
        hour: String(r.hour), count: Number(r.count ?? 0), value: Number(r.value ?? 0),
      })),
      smsUsage: {
        sentToday,
        delivered: Number(sms.delivered ?? 0),
        failed: Number(sms.failed ?? 0),
        pending: Number(sms.pending ?? 0),
        creditsRemaining,
        creditsTotal: creditsRemaining + sentToday,
      },
      transactions: transactions.rows,
    });
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Organizations (all groups, cross-tenant)
// ─────────────────────────────────────────────────────────────────────────────
export interface GroupListParams {
  page:    number;
  limit:   number;
  search?: string;
  status?: string;
  plan?:   string;
  /**
   * Which product's subscription the `plan`/`subscription_status` columns
   * describe, and which the `plan` filter applies to. Defaults to kitabu_yetu,
   * so the existing admin view is unchanged. Migration 127.
   */
  product?: SubscriptionProduct;
}

// Lists GROUPS (the platform tenants / chamas) for the admin portal. Named
// after its subject — the separate `organizations` federating bodies (banks,
// SACCOs, foundations) are managed in admin-organizations.service.ts.
export async function listGroups(params: GroupListParams) {
  return withAdminDb(async (db: PoolClient) => {
    const { page, limit, search, status, plan } = params;
    const offset = (page - 1) * limit;
    const conditions: string[] = [];
    // $1 is always the product, consumed by the subscription LATERAL below in
    // BOTH the data and count queries — so it is pushed before any filter and
    // filter placeholders start at $2, keeping the two queries' parameter
    // lists identical (they already had to match; the count query reuses
    // `values` verbatim).
    const values: unknown[]    = [params.product ?? DEFAULT_PRODUCT];
    let   idx = 2;

    if (search) {
      conditions.push(`(g.name ILIKE $${idx} OR g.registration_number ILIKE $${idx})`);
      values.push(`%${search}%`); idx++;
    }
    if (status) {
      conditions.push(`g.onboarding_status = $${idx}`);
      values.push(status); idx++;
    }
    if (plan) {
      conditions.push(`s.plan_type = $${idx}`);
      values.push(plan); idx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [data, count] = await Promise.all([
      db.query(`
        SELECT
          g.id, g.name, g.type AS group_type, g.onboarding_status,
          hs.score AS health_score, hs.category AS health_rag, g.created_at,
          g.suspended_at, g.suspended_reason,
          -- No COALESCE fallback: since the 2026-08-13 paid-only cutover
          -- (migration 139) a group with no active-subscription row is not
          -- on a free "starter" plan, it's LOCKED (no plan at all). Faking
          -- starter/active here made every locked, non-paying group visually
          -- indistinguishable from a real paying customer in this list.
          s.plan_type AS plan,
          s.status    AS subscription_status,
          COALESCE(mem.member_count, 0)         AS member_count,
          COALESCE(con.total_contributions, 0)  AS total_contributions,
          COALESCE(ln.active_loans, 0)          AS active_loans
        FROM public.groups g
        -- LATERAL, not a plain LEFT JOIN: since migration 127 a group can hold
        -- one active subscription per product, and s.plan_type is in the GROUP
        -- BY below — so a plain join would emit one row PER PRODUCT and list
        -- the same group twice, while the count query's COUNT(DISTINCT g.id)
        -- kept counting it once, silently desynchronising the pagination.
        -- Same shape the governance-health join below already uses.
        LEFT JOIN LATERAL (
          SELECT sub.plan_type, sub.status FROM public.subscriptions sub
          WHERE sub.group_id = g.id AND sub.status = 'active' AND sub.product = $1
          LIMIT 1
        ) s ON true
        -- LATERAL per child table, not a flat multi-table LEFT JOIN: joining
        -- group_members/contributions/loans together fans every contribution
        -- row out across every loan row (and vice versa) before the SUM runs.
        -- SUM(DISTINCT c.amount) — the prior attempt to guard against this —
        -- doesn't fix it either: it collapses the sum to one copy of each
        -- DISTINCT amount VALUE, silently under-counting any group where two
        -- real contributions share an amount (e.g. two members both paying
        -- the standard KES 100 — proven live on a real group, 650 shown vs.
        -- 1,050 actual). See getGroupById's near-identical comment for the
        -- over-counting half of this same bug class.
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS member_count FROM public.group_members gm
          WHERE gm.group_id = g.id AND gm.status = 'active'
        ) mem ON true
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'completed'), 0) AS total_contributions
          FROM public.contributions c WHERE c.group_id = g.id
        ) con ON true
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(l.principal_amount) FILTER (WHERE l.status = 'active'), 0) AS active_loans
          FROM public.loans l WHERE l.group_id = g.id
        ) ln ON true
        LEFT JOIN LATERAL (
          SELECT score, category FROM public.governance_health_scores h
          WHERE h.group_id = g.id ORDER BY h.as_of DESC LIMIT 1
        ) hs ON true
        ${where}
        GROUP BY g.id, s.plan_type, s.status, mem.member_count, con.total_contributions, ln.active_loans, hs.score, hs.category
        ORDER BY g.created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `, [...values, limit, offset]),
      db.query(`
        SELECT COUNT(DISTINCT g.id) AS total
        FROM public.groups g
        LEFT JOIN LATERAL (
          SELECT sub.plan_type, sub.status FROM public.subscriptions sub
          WHERE sub.group_id = g.id AND sub.status = 'active' AND sub.product = $1
          LIMIT 1
        ) s ON true
        ${where}
      `, values),
    ]);

    return { items: data.rows, total: parseInt(count.rows[0].total, 10), page, limit };
  });
}

export async function getGroupById(groupId: string) {
  return withAdminDb(async (db: PoolClient) => {
    const [group, stats, recentActivity] = await Promise.all([
      db.query(`
        SELECT g.*, g.type AS group_type, s.plan_type AS plan, s.status AS subscription_status,
               s.expires_at AS current_period_end, s.next_billing_date,
               m.first_name || ' ' || m.last_name AS admin_name,
               m.phone AS admin_phone, m.email AS admin_email
        FROM public.groups g
        -- 'trial' is included for forward-compatibility with the subscription_status
        -- enum, but no code path has created a trial subscription since the
        -- 2026-08-13 paid-only cutover (migration 139 stopped register_group()
        -- seeding one) — in practice this only ever matches 'active' today.
        LEFT JOIN public.subscriptions s ON s.group_id = g.id AND s.status IN ('active','trial')
        LEFT JOIN public.group_members gm ON gm.group_id = g.id AND gm.role = 'chairperson'
        LEFT JOIN public.members m ON m.id = gm.member_id
        WHERE g.id = $1
        LIMIT 1
      `, [groupId]),
      db.query(`
        -- LATERAL per child table, not a flat multi-table LEFT JOIN: joining
        -- group_members/contributions/loans/payments/support_tickets in one
        -- flat join cross-products every combination of their rows for this
        -- group, so a plain SUM(c.amount) counts each contribution once per
        -- row of every OTHER joined table (loans x payments x tickets x
        -- members) instead of once. Proven live: a group with 9 members, 7
        -- contributions (KES 1,050 total) and 11 payments (KES 1,220 total)
        -- reported total_contributions=103,950 (99x) and total_payments=
        -- 76,860 (63x) before this fix. COUNT(DISTINCT ...) masked the same
        -- fan-out for the *count* columns but never protected the SUMs.
        SELECT
          COALESCE(mem.active_members, 0)      AS active_members,
          COALESCE(con.total_contributions, 0) AS total_contributions,
          COALESCE(ln.active_loans_amount, 0)  AS active_loans_amount,
          COALESCE(ln.active_loans_count, 0)   AS active_loans_count,
          COALESCE(pay.total_payments, 0)      AS total_payments,
          COALESCE(tk.open_tickets, 0)         AS open_tickets
        FROM public.groups g
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS active_members FROM public.group_members gm
          WHERE gm.group_id = g.id AND gm.status = 'active'
        ) mem ON true
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'completed'), 0) AS total_contributions
          FROM public.contributions c WHERE c.group_id = g.id
        ) con ON true
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(l.principal_amount) FILTER (WHERE l.status = 'active'), 0) AS active_loans_amount,
                 COUNT(*) FILTER (WHERE l.status = 'active') AS active_loans_count
          FROM public.loans l WHERE l.group_id = g.id
        ) ln ON true
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'completed'), 0) AS total_payments
          FROM public.payments p WHERE p.group_id = g.id
        ) pay ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS open_tickets FROM public.support_tickets st
          WHERE st.group_id = g.id AND st.status NOT IN ('resolved','closed')
        ) tk ON true
        WHERE g.id = $1
      `, [groupId]),
      db.query(`
        SELECT action, resource_type AS table_name, created_at
        FROM public.audit_logs
        WHERE group_id = $1
        ORDER BY created_at DESC
        LIMIT 20
      `, [groupId]),
    ]);

    if (!group.rows[0]) return null;
    return { ...group.rows[0], stats: stats.rows[0] ?? {}, recentActivity: recentActivity.rows };
  });
}

export async function updateGroupStatus(
  groupId: string,
  action: 'approve' | 'suspend' | 'activate' | 'deactivate',
  adminId: string,
  reason?: string,
) {
  return withAdminDb(async (db: PoolClient) => {
    const statusMap = {
      approve:    'active',
      suspend:    'suspended',
      activate:   'active',
      deactivate: 'deactivated',
    };

    await db.query(`
      UPDATE public.groups SET
        onboarding_status = $1,
        suspended_at      = CASE WHEN $1 = 'suspended' THEN NOW() ELSE NULL END,
        suspended_reason  = CASE WHEN $1 = 'suspended' THEN $3 ELSE NULL END,
        kyc_verified_at   = CASE WHEN $1 = 'active' AND onboarding_status != 'active' THEN NOW() ELSE kyc_verified_at END,
        kyc_verified_by   = CASE WHEN $1 = 'active' AND onboarding_status != 'active' THEN $2::uuid ELSE kyc_verified_by END
      WHERE id = $4
    `, [statusMap[action], adminId, reason ?? null, groupId]);

    return { success: true };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Super-admin corrections
//
// Until now a super_admin could change a group's STATUS and nothing else —
// there was no way anywhere in the product to fix a typo in a group's name or
// a member's name. These two functions are that, deliberately scoped:
//
//   - Group: name + profile fields.
//   - Member: first/last name and email.
//   - Member PHONE is NOT editable, by decision. It is the login identity and
//     is UNIQUE platform-wide, so changing it changes who can sign in to the
//     account — a different and much riskier operation than fixing a typo.
//
// Both write an audit_logs row with old AND new values: these edit real
// member PII across tenant boundaries, so "who changed this, from what, to
// what" has to survive the change.
// ─────────────────────────────────────────────────────────────────────────────

/** Fields a super_admin may correct on a group. All optional — only what is sent is changed. */
export interface UpdateGroupProfileInput {
  name?:             string;
  type?:             string;
  countyId?:         string | null;
  subCounty?:        string | null;
  ward?:             string | null;
  villageEstate?:    string | null;
  primaryObjective?: string | null;
  meetingFrequency?: string | null;
  meetingDay?:       string | null;
  meetingTime?:      string | null;
}

const GROUP_PROFILE_COLUMNS: Record<keyof UpdateGroupProfileInput, string> = {
  name:             'name',
  type:             '"type"',
  countyId:         'county_id',
  subCounty:        'sub_county',
  ward:             'ward',
  villageEstate:    'village_estate',
  primaryObjective: 'primary_objective',
  meetingFrequency: 'meeting_frequency',
  meetingDay:       'meeting_day',
  meetingTime:      'meeting_time',
};

/**
 * Postgres enum columns need an explicit cast when fed a text parameter.
 * Without these the UPDATE fails with "column X is of type Y but expression
 * is of type text" — the same class of parameter-typing failure this codebase
 * has been bitten by repeatedly.
 */
const GROUP_PROFILE_CASTS: Partial<Record<keyof UpdateGroupProfileInput, string>> = {
  type:             '::group_type',
  primaryObjective: '::primary_objective',
  meetingFrequency: '::meeting_frequency',
  meetingDay:       '::meeting_day',
  meetingTime:      '::time',
  countyId:         '::uuid',
};

export async function updateGroupProfile(
  groupId: string,
  input:   UpdateGroupProfileInput,
  adminId: string,
) {
  const entries = (Object.keys(input) as (keyof UpdateGroupProfileInput)[])
    .filter((k) => input[k] !== undefined);
  if (entries.length === 0) throw new ValidationError('No fields to update');

  return withAdminDb(async (db: PoolClient) => {
    const { rows: beforeRows } = await db.query(
      `SELECT name, "type", county_id, sub_county, ward, village_estate,
              primary_objective, meeting_frequency, meeting_day, meeting_time
       FROM public.groups WHERE id = $1`,
      [groupId],
    );
    if (!beforeRows[0]) throw new NotFoundError('Group', groupId);

    const sets: string[] = [];
    const vals: unknown[] = [groupId];
    let idx = 2;
    for (const key of entries) {
      sets.push(`${GROUP_PROFILE_COLUMNS[key]} = $${idx}${GROUP_PROFILE_CASTS[key] ?? ''}`);
      vals.push(input[key] === '' ? null : input[key]);
      idx += 1;
    }

    let after;
    try {
      const { rows } = await db.query(
        `UPDATE public.groups SET ${sets.join(', ')}, updated_at = NOW()
         WHERE id = $1
         RETURNING id, name, "type", county_id, sub_county, ward, village_estate,
                   primary_objective, meeting_frequency, meeting_day, meeting_time`,
        vals,
      );
      after = rows[0];
    } catch (err) {
      // uq_group_name_per_county: (lower(trim(name)), county) must be unique
      // among non-archived groups. A rename into an existing name is a real,
      // reachable user action — answer it with a readable 409 rather than
      // letting a raw constraint violation surface as a 500.
      if (err instanceof DatabaseError && err.code === '23505') {
        throw new ConflictError(
          'Another group in this county already uses that name. Pick a different name.',
        );
      }
      throw err;
    }

    await db.query(
      `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
       VALUES ($1, $2, 'group.profile_update', 'group', $1, $3::jsonb, $4::jsonb)`,
      [groupId, adminId, JSON.stringify(beforeRows[0]), JSON.stringify(after)],
    );

    return after;
  });
}

/** Fields a super_admin may correct on a member. Phone is deliberately absent — see above. */
export interface UpdateMemberProfileInput {
  firstName?: string;
  lastName?:  string;
  email?:     string | null;
}

export async function updateMemberProfile(
  memberId: string,
  input:    UpdateMemberProfileInput,
  adminId:  string,
  groupId?: string,
) {
  const wantsName  = input.firstName !== undefined || input.lastName !== undefined;
  const wantsEmail = input.email !== undefined;
  if (!wantsName && !wantsEmail) throw new ValidationError('No fields to update');

  return withAdminDb(async (db: PoolClient) => {
    const { rows: beforeRows } = await db.query<{
      first_name: string; last_name: string; email: string | null;
    }>(
      `SELECT first_name, last_name, email FROM members WHERE id = $1`,
      [memberId],
    );
    if (!beforeRows[0]) throw new NotFoundError('Member', memberId);
    const before = beforeRows[0];

    const sets: string[] = [];
    const vals: unknown[] = [memberId];
    let idx = 2;
    if (input.firstName !== undefined) { sets.push(`first_name = $${idx++}`); vals.push(input.firstName); }
    if (input.lastName  !== undefined) { sets.push(`last_name  = $${idx++}`); vals.push(input.lastName); }
    if (wantsEmail) { sets.push(`email = $${idx++}`); vals.push(input.email === '' ? null : input.email); }

    let after;
    try {
      const { rows } = await db.query(
        `UPDATE members SET ${sets.join(', ')}, updated_at = NOW()
         WHERE id = $1
         RETURNING id, first_name, last_name, email, phone`,
        vals,
      );
      after = rows[0];
    } catch (err) {
      // members.email carries a UNIQUE constraint.
      if (err instanceof DatabaseError && err.code === '23505') {
        throw new ConflictError('That email address is already in use by another member.');
      }
      throw err;
    }

    // A member's name also lives on `person`, the CROSS-GROUP identity record
    // that group_members rows point at. Updating only `members` would leave
    // the same human showing the old name in every other group they belong to
    // — the correction would look applied and silently not be. Kept in the
    // same transaction so the two can never disagree.
    if (wantsName) {
      const fullName = `${after.first_name} ${after.last_name}`.trim();
      await db.query(
        `UPDATE person p
         SET    full_name = $2
         FROM   group_members gm
         WHERE  gm.person_id = p.id AND gm.member_id = $1`,
        [memberId, fullName],
      );
    }

    await db.query(
      `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
       VALUES ($1, $2, 'member.profile_update', 'member', $3, $4::jsonb, $5::jsonb)`,
      [
        groupId ?? null, adminId, memberId,
        JSON.stringify(before),
        JSON.stringify({ first_name: after.first_name, last_name: after.last_name, email: after.email }),
      ],
    );

    return after;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Platform users (all members with platformRole filter)
// ─────────────────────────────────────────────────────────────────────────────
export async function listPlatformUsers(params: {
  page: number; limit: number; search?: string; role?: string;
}) {
  return withAdminDb(async (db: PoolClient) => {
    const { page, limit, search, role } = params;
    const offset = (page - 1) * limit;
    const conds: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;

    if (search) {
      conds.push(`(m.first_name ILIKE $${idx} OR m.last_name ILIKE $${idx} OR m.email ILIKE $${idx} OR m.phone ILIKE $${idx})`);
      vals.push(`%${search}%`); idx++;
    }
    if (role) {
      conds.push(`(m.platform_role = $${idx} OR gm.role = $${idx})`);
      vals.push(role); idx++;
    }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const [data, count] = await Promise.all([
      db.query(`
        SELECT
          m.id, m.first_name, m.last_name, m.email,
          m.phone AS phone_number,
          m.platform_role, m.created_at, m.last_login_at,
          gm.group_id, gm.member_code, gm.role AS group_role, gm.role_id,
          gm.status AS status, gm.joined_at,
          g.name AS group_name,
          r.name AS role_name,
          org.name AS organization_name
        FROM public.members m
        LEFT JOIN public.group_members gm ON gm.member_id = m.id AND gm.status = 'active'
        LEFT JOIN public.groups g ON g.id = gm.group_id
        LEFT JOIN public.roles r ON r.id = gm.role_id
        LEFT JOIN LATERAL (
          SELECT o.name
          FROM public.organization_group_access nga
          JOIN public.organizations o ON o.id = nga.organization_id
          WHERE nga.group_id = gm.group_id AND nga.is_active
          ORDER BY nga.created_at ASC
          LIMIT 1
        ) org ON true
        ${where}
        ORDER BY m.created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `, [...vals, limit, offset]),
      db.query(`SELECT COUNT(DISTINCT m.id) AS total FROM public.members m LEFT JOIN public.group_members gm ON gm.member_id = m.id AND gm.status = 'active' ${where}`, vals),
    ]);

    return { items: data.rows, total: parseInt(count.rows[0].total, 10), page, limit };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Member drill-down (SUPER_ADMIN_PLATFORM_AUDIT.md §2.6/§2.7 Phase 1) — a
// real cross-tenant member detail, reachable from both admin/users and a new
// member table on admin/groups/[id]. Financial snapshot reuses
// member-balances.service.ts's computeMemberFinancialSnapshot (built for the
// (member) portal's own wallet) rather than re-deriving the same savings/
// loan/shares SQL a third time. Credit score is read directly here (not via
// credit-scores.service.ts's getLatestForMember) because that function is
// deliberately group_id-scoped for its own tenant-facing use — a cross-
// tenant admin read is a different, simpler query, not a variant worth
// threading a TenantContext through.
// ─────────────────────────────────────────────────────────────────────────────

/** Active members of one group, for the member table on admin/groups/[id]. */
export async function listGroupMembers(groupId: string, params: { page: number; limit: number }) {
  return withAdminDb(async (db: PoolClient) => {
    const { page, limit } = params;
    const offset = (page - 1) * limit;

    const [data, count] = await Promise.all([
      db.query(`
        SELECT m.id, m.first_name, m.last_name, m.email, m.phone,
               gm.member_code, gm.role AS group_role, gm.status, gm.joined_at
        FROM public.group_members gm
        JOIN public.members m ON m.id = gm.member_id
        WHERE gm.group_id = $1 AND gm.status = 'active'
        ORDER BY m.first_name, m.last_name
        LIMIT $2 OFFSET $3
      `, [groupId, limit, offset]),
      db.query(`SELECT COUNT(*) AS total FROM public.group_members WHERE group_id = $1 AND status = 'active'`, [groupId]),
    ]);

    return { items: data.rows, total: parseInt(count.rows[0].total, 10), page, limit };
  });
}

/** Cross-tenant member detail: profile, active group/org context, financial snapshot, recent activity, credit score. */
export async function getAdminMemberDetail(memberId: string) {
  return withAdminDb(async (db: PoolClient) => {
    const { rows: profileRows } = await db.query(`
      SELECT m.id, m.first_name, m.last_name, m.email, m.phone, m.national_id,
             m.platform_role, m.is_active, m.created_at, m.last_login_at,
             gm.group_id, gm.member_code, gm.role AS group_role, gm.status AS membership_status, gm.joined_at,
             g.name AS group_name, g.group_code,
             org.name AS organization_name
      FROM public.members m
      LEFT JOIN public.group_members gm ON gm.member_id = m.id AND gm.status = 'active'
      LEFT JOIN public.groups g ON g.id = gm.group_id
      LEFT JOIN LATERAL (
        SELECT o.name
        FROM public.organization_group_access oga
        JOIN public.organizations o ON o.id = oga.organization_id
        WHERE oga.group_id = gm.group_id AND oga.is_active = TRUE
        LIMIT 1
      ) org ON true
      WHERE m.id = $1
      LIMIT 1
    `, [memberId]);

    const profile = profileRows[0];
    if (!profile) return null;

    const [snapshot, activity, creditScore] = await Promise.all([
      profile.group_id
        ? computeMemberFinancialSnapshot(db, profile.group_id, memberId)
        : Promise.resolve([]),
      db.query(`
        SELECT id, 'contribution' AS type, amount, contribution_date::text AS date, status
        FROM public.contributions WHERE member_id = $1
        UNION ALL
        SELECT id, 'loan_repayment' AS type, amount_paid AS amount, COALESCE(payment_date, due_date)::text AS date, status
        FROM public.loan_repayments WHERE member_id = $1
        ORDER BY date DESC LIMIT 10
      `, [memberId]),
      profile.group_id
        ? db.query(`
            SELECT overall_score, financial_score, social_score, reliability_tier, loan_eligibility_limit, computed_at
            FROM public.credit_scores WHERE member_id = $1 AND group_id = $2
            ORDER BY computed_at DESC LIMIT 1
          `, [memberId, profile.group_id])
        : Promise.resolve({ rows: [] }),
    ]);

    return {
      profile,
      snapshot: snapshot[0] ?? null,
      recentActivity: activity.rows,
      creditScore: creditScore.rows[0] ?? null,
    };
  });
}

export async function updatePlatformUserRole(
  memberId: string,
  platformRole: string,
) {
  return withAdminDb(async (db: PoolClient) => {
    await db.query(
      `UPDATE public.members SET platform_role = $1 WHERE id = $2`,
      [platformRole, memberId],
    );
    return { success: true };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Billing admin
// ─────────────────────────────────────────────────────────────────────────────
export async function getBillingOverview() {
  return withAdminDb(async (db: PoolClient) => {
    const [summary, byPlan, recentPayments, outstanding] = await Promise.all([
      db.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'active')    AS active_subscriptions,
          COUNT(*) FILTER (WHERE status = 'expired')   AS expired_subscriptions,
          COUNT(*) FILTER (WHERE status = 'suspended') AS suspended_subscriptions,
          COALESCE(SUM(monthly_fee) FILTER (WHERE status = 'active'), 0) AS mrr,
          COUNT(*) FILTER (WHERE expires_at < NOW() AND status = 'active') AS overdue_count
        FROM public.subscriptions
      `),
      db.query(`
        SELECT plan_type AS plan, COUNT(*) AS count,
          COALESCE(SUM(monthly_fee), 0) AS revenue
        FROM public.subscriptions WHERE status = 'active'
        GROUP BY plan_type ORDER BY revenue DESC
      `),
      db.query(`
        SELECT p.id, p.amount, p.status, p.payment_method, p.created_at,
               g.name AS group_name, i.invoice_number
        FROM public.payments p
        LEFT JOIN public.groups g ON g.id = p.group_id
        LEFT JOIN public.invoices i ON i.id = p.invoice_id
        ORDER BY p.created_at DESC LIMIT 20
      `),
      db.query(`
        SELECT i.id, i.invoice_number,
               (i.total_amount - COALESCE(i.paid_amount, 0)) AS amount_due,
               i.due_date, i.status,
               (i.status = 'pending' AND i.due_date < NOW()) AS is_overdue,
               g.name AS group_name
        FROM public.invoices i
        LEFT JOIN public.groups g ON g.id = i.group_id
        WHERE i.status = 'pending'
        ORDER BY i.due_date ASC LIMIT 20
      `),
    ]);

    return {
      summary:        summary.rows[0],
      byPlan:         byPlan.rows,
      recentPayments: recentPayments.rows,
      outstanding:    outstanding.rows,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Support tickets
// ─────────────────────────────────────────────────────────────────────────────
export async function listSupportTickets(params: {
  page: number; limit: number; status?: string; priority?: string; search?: string;
}) {
  return withAdminDb(async (db: PoolClient) => {
    const { page, limit, status, priority, search } = params;
    const offset = (page - 1) * limit;
    const conds: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;

    if (status)   { conds.push(`t.status = $${idx}`);               vals.push(status);   idx++; }
    if (priority) { conds.push(`t.priority = $${idx}`);             vals.push(priority); idx++; }
    if (search)   { conds.push(`(t.subject ILIKE $${idx} OR t.ticket_number ILIKE $${idx})`); vals.push(`%${search}%`); idx++; }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const [data, count] = await Promise.all([
      db.query(`
        SELECT t.*, g.name AS group_name,
               m.first_name || ' ' || m.last_name AS member_name,
               a.first_name || ' ' || a.last_name AS assigned_name,
               (SELECT COUNT(*) FROM public.ticket_comments tc WHERE tc.ticket_id = t.id) AS comment_count
        FROM public.support_tickets t
        LEFT JOIN public.groups g ON g.id = t.group_id
        LEFT JOIN public.members m ON m.id = t.member_id
        LEFT JOIN public.members a ON a.id = t.assigned_to
        ${where}
        ORDER BY
          CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
          t.created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `, [...vals, limit, offset]),
      db.query(`SELECT COUNT(*) AS total FROM public.support_tickets t ${where}`, vals),
    ]);

    return { items: data.rows, total: parseInt(count.rows[0].total, 10), page, limit };
  });
}

export async function createSupportTicket(data: {
  groupId?: string; memberId?: string; category: string; priority: string;
  subject: string; description: string;
}) {
  return withAdminDb(async (db: PoolClient) => {
    const { rows } = await db.query(`
      INSERT INTO public.support_tickets (group_id, member_id, category, priority, subject, description, sla_breach_at)
      VALUES ($1, $2, $3, $4, $5, $6,
        NOW() + INTERVAL '1 hour' * CASE $4 WHEN 'urgent' THEN 4 WHEN 'high' THEN 8 WHEN 'normal' THEN 24 ELSE 48 END)
      RETURNING *
    `, [data.groupId ?? null, data.memberId ?? null, data.category, data.priority, data.subject, data.description]);
    return rows[0];
  });
}

export async function updateTicketStatus(
  ticketId: string,
  status: string,
  adminId: string,
  resolution?: string,
) {
  return withAdminDb(async (db: PoolClient) => {
    await db.query(`
      UPDATE public.support_tickets SET
        status = $1,
        resolved_at   = CASE WHEN $1 = 'resolved' THEN NOW() ELSE resolved_at END,
        closed_at     = CASE WHEN $1 = 'closed'   THEN NOW() ELSE closed_at END,
        resolution    = COALESCE($3, resolution),
        first_response_at = COALESCE(first_response_at, NOW())
      WHERE id = $2
    `, [status, ticketId, resolution ?? null]);

    if (resolution) {
      await db.query(`
        INSERT INTO public.ticket_comments (ticket_id, author_id, is_internal, content)
        VALUES ($1, $2, false, $3)
      `, [ticketId, adminId, resolution]);
    }

    return { success: true };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit logs
// ─────────────────────────────────────────────────────────────────────────────
export async function listAuditLogs(params: {
  page: number; limit: number; groupId?: string;
  action?: string; table?: string; search?: string;
  from?: string; to?: string;
}) {
  return withAdminDb(async (db: PoolClient) => {
    const { page, limit, groupId, action, table: tbl, search, from, to } = params;
    const offset = (page - 1) * limit;
    const conds: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;

    if (groupId) { conds.push(`al.group_id = $${idx}`);                   vals.push(groupId); idx++; }
    if (action)  { conds.push(`al.action = $${idx}`);                      vals.push(action);  idx++; }
    if (tbl)     { conds.push(`al.resource_type = $${idx}`);               vals.push(tbl);     idx++; }
    if (search)  { conds.push(`al.resource_type ILIKE $${idx}`);           vals.push(`%${search}%`); idx++; }
    if (from)    { conds.push(`al.created_at >= $${idx}`);                 vals.push(from);    idx++; }
    if (to)      { conds.push(`al.created_at <= $${idx}`);                 vals.push(to);      idx++; }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const [data, count] = await Promise.all([
      db.query(`
        SELECT al.*, al.resource_type AS table_name, g.name AS group_name,
               m.first_name || ' ' || m.last_name AS actor_name
        FROM public.audit_logs al
        LEFT JOIN public.groups g ON g.id = al.group_id
        LEFT JOIN public.members m ON m.id = al.actor_id
        ${where}
        ORDER BY al.created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `, [...vals, limit, offset]),
      db.query(`SELECT COUNT(*) AS total FROM public.audit_logs al ${where}`, vals),
    ]);

    return { items: data.rows, total: parseInt(count.rows[0].total, 10), page, limit };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature flags
// ─────────────────────────────────────────────────────────────────────────────
export async function listFeatureFlags() {
  return withAdminDb(async (db: PoolClient) => {
    const { rows } = await db.query(`SELECT * FROM public.feature_flags ORDER BY key ASC`);
    return rows;
  });
}

export async function toggleFeatureFlag(key: string, enabled: boolean, adminId: string) {
  return withAdminDb(async (db: PoolClient) => {
    await db.query(
      `UPDATE public.feature_flags SET enabled = $1, updated_by = $2::uuid WHERE key = $3`,
      [enabled, adminId, key],
    );
    return { success: true };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics aggregates
// ─────────────────────────────────────────────────────────────────────────────
export async function getPlatformAnalytics() {
  return cached(keys.cache('platform-analytics', 'platform'), 120, () => withAdminDb(async (db: PoolClient) => {
    const [growth, topGroups, loanHealth, welfareStats] = await Promise.all([
      db.query(`
        SELECT
          DATE_TRUNC('month', created_at) AS month,
          TO_CHAR(DATE_TRUNC('month', created_at), 'Mon YYYY') AS label,
          COUNT(*) AS new_groups,
          SUM(COUNT(*)) OVER (ORDER BY DATE_TRUNC('month', created_at)) AS cumulative_groups
        FROM public.groups
        WHERE created_at >= NOW() - INTERVAL '12 months'
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY month ASC
      `),
      db.query(`
        SELECT g.id, g.name, g.type AS group_type,
               COUNT(DISTINCT gm.id) AS members,
               COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'completed'), 0) AS contributions,
               COALESCE(SUM(l.principal_amount) FILTER (WHERE l.status IN ('active','disbursed')), 0) AS loan_book
        FROM public.groups g
        LEFT JOIN public.group_members gm ON gm.group_id = g.id AND gm.status = 'active'
        LEFT JOIN public.contributions c ON c.group_id = g.id
        LEFT JOIN public.loans l ON l.group_id = g.id
        GROUP BY g.id
        ORDER BY contributions DESC
        LIMIT 10
      `),
      db.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'active')    AS active,
          COUNT(*) FILTER (WHERE status = 'defaulted') AS defaulted,
          COUNT(*) FILTER (WHERE status = 'completed') AS completed,
          COALESCE(SUM(principal_amount) FILTER (WHERE status = 'active'), 0) AS total_outstanding,
          COALESCE(AVG(interest_rate), 0) AS avg_interest_rate
        FROM public.loans
      `),
      db.query(`
        SELECT
          COUNT(*) AS total_requests,
          COALESCE(SUM(amount_requested), 0) AS total_requested,
          COALESCE(SUM(amount_disbursed) FILTER (WHERE status = 'disbursed'), 0) AS total_disbursed,
          COUNT(*) FILTER (WHERE status = 'pending') AS pending_requests
        FROM public.welfare_requests
      `),
    ]);

    return {
      growth:       growth.rows,
      topGroups:    topGroups.rows,
      loanHealth:   loanHealth.rows[0],
      welfareStats: welfareStats.rows[0],
    };
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Unrouted M-Pesa payments (staff/super_admin reconciliation)
//
// `mpesa-unrouted.service.ts`'s listUnrouted/resolveUnrouted are treasurer-
// facing and tenant-scoped: resolveUnrouted requires the caller's group to
// match the row's candidate_group_id, and the C2B router leaves
// candidate_group_id NULL whenever it can't even guess a group
// (reason='unknown_prefix') — which is most of these. No group's treasurer
// session can ever reach those rows through the normal RLS-scoped path, no
// matter how obvious the right member is from the receipt/name/ref. These
// two give staff the same "allocate or dismiss" action, but scoped to the
// whole platform via withAdminDb, with the group picked explicitly rather
// than inferred.
// ─────────────────────────────────────────────────────────────────────────────

export interface UnroutedPaymentRow {
  id:                  string;
  receipt:             string;
  phone:               string;
  amount:              string;
  bill_ref:            string | null;
  reason:              string;
  candidate_group_id:  string | null;
  candidate_group_name: string | null;
  resolved:            boolean;
  created_at:          string;
}

export async function listUnroutedPayments(params: {
  page: number; limit: number; search?: string;
}) {
  return withAdminDb(async (db: PoolClient) => {
    const { page, limit, search } = params;
    const offset = (page - 1) * limit;
    const conds: string[] = ['u.resolved = false'];
    const vals: unknown[] = [];
    let idx = 1;

    if (search) {
      conds.push(`(u.receipt ILIKE $${idx} OR u.bill_ref ILIKE $${idx})`);
      vals.push(`%${search}%`);
      idx++;
    }
    const where = `WHERE ${conds.join(' AND ')}`;

    const [data, count] = await Promise.all([
      db.query<UnroutedPaymentRow>(`
        SELECT u.id, u.receipt, u.phone, u.amount, u.bill_ref, u.reason,
               u.candidate_group_id, g.name AS candidate_group_name,
               u.resolved, u.created_at
        FROM   public.mpesa_unrouted u
        LEFT   JOIN public.groups g ON g.id = u.candidate_group_id
        ${where}
        ORDER  BY u.created_at ASC
        LIMIT  $${idx} OFFSET $${idx + 1}
      `, [...vals, limit, offset]),
      db.query(`SELECT COUNT(*) AS total FROM public.mpesa_unrouted u ${where}`, vals),
    ]);

    return { items: data.rows, total: parseInt(count.rows[0].total, 10), page, limit };
  });
}

/**
 * Staff-scoped equivalent of mpesa-unrouted.service.ts's resolveUnrouted —
 * same two actions (allocate / dismiss), same accounting path
 * (postContributionJournal + markSpineAllocated), but callable for ANY
 * unrouted row regardless of candidate_group_id, with the target group
 * supplied explicitly by the staff member rather than inferred from routing.
 *
 * `createdBy` on the journal is deliberately null, and `adminId` (a
 * platform_users id, not a members id) is recorded only in
 * resolution_notes — mirroring how updateTicketStatus above attributes a
 * staff action without assuming a members-table identity for the actor.
 */
export async function resolveUnroutedPayment(
  id: string,
  action: 'allocate' | 'dismiss',
  opts: { groupId?: string; memberId?: string; notes?: string; adminId: string },
): Promise<{ success: true }> {
  return withAdminDb(async (db: PoolClient) => {
    const { rows } = await db.query<{
      id: string; receipt: string; amount: string; bill_ref: string | null; resolved: boolean;
    }>(
      `SELECT id, receipt, amount, bill_ref, resolved FROM public.mpesa_unrouted WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError('Unrouted receipt', id);
    if (row.resolved) return { success: true }; // already handled — idempotent

    // mpesa_unrouted.resolved_by is a real FK to members(id); opts.adminId is
    // a platform_users id, not a member, so it goes in resolution_notes only
    // (same reasoning as payment_events.actor above) — resolved_by stays NULL
    // for a staff-initiated resolution, same as recorded_by/createdBy below.
    const notes = opts.notes
      ? `${opts.notes} (staff action, admin ${opts.adminId})`
      : `Resolved by staff (admin ${opts.adminId})`;

    if (action === 'dismiss') {
      await db.query(
        `UPDATE public.mpesa_unrouted
         SET resolved=true, resolved_by=NULL, resolved_at=NOW(),
             resolved_to_group_id=$2, resolution_notes=$3
         WHERE id=$1`,
        [id, opts.groupId ?? null, notes],
      );
      return { success: true };
    }

    if (!opts.groupId) throw new ValidationError('groupId is required to allocate');
    if (!opts.memberId) throw new ValidationError('memberId is required to allocate');

    const { membershipId } = await assertActiveMembership(db, opts.groupId, opts.memberId);

    const amount = parseFloat(row.amount);
    const { rows: contribRows } = await db.query<{ id: string }>(
      `INSERT INTO public.contributions
         (group_id, member_id, group_membership_id, amount, contribution_date,
          status, payment_method, mpesa_receipt_number, notes, recorded_by)
       VALUES ($1,$2,$3,$4,CURRENT_DATE,'completed','mpesa',$5,$6,NULL)
       ON CONFLICT (mpesa_receipt_number) DO NOTHING
       RETURNING id`,
      [
        opts.groupId, opts.memberId, membershipId, amount.toFixed(2), row.receipt,
        `Manually routed from unrouted receipt by platform staff (${row.bill_ref ?? 'no ref'})`,
      ],
    );
    const contributionId = contribRows[0]?.id ?? null;

    if (contributionId) {
      await postContributionJournal(db, {
        groupId: opts.groupId, contributionId, amount,
        entryDate: new Date().toISOString().slice(0, 10), reference: row.receipt,
        createdBy: null, isTest: IS_SANDBOX,
      });

      await db.query(
        `UPDATE public.contributions
         SET    payment_id = (SELECT id FROM public.payments WHERE mpesa_receipt_number = $1)
         WHERE  id = $2 AND payment_id IS NULL`,
        [row.receipt, contributionId],
      );
      await markSpineAllocated(db, row.receipt, {
        // NOT opts.adminId: payment_events.actor is a real FK to members(id),
        // and a backoffice staff/platform_users id is not a member — passing
        // it here would either FK-violate or silently misattribute the event
        // to an unrelated member. NULL means "system", same as every other
        // non-member-initiated action in this table. The real staff id is
        // still recorded, just in detail (no FK) rather than actor.
        actor:  null,
        detail: { product: 'savings', contributionId, groupId: opts.groupId, via: 'admin_unrouted_resolution', staffAdminId: opts.adminId },
      });
    }

    await db.query(
      `UPDATE public.mpesa_unrouted
       SET resolved=true, resolved_by=NULL, resolved_at=NOW(),
           resolved_to_group_id=$2, resolved_to_contribution=$3, resolution_notes=$4
       WHERE id=$1`,
      [id, opts.groupId, contributionId, notes],
    );
    return { success: true };
  });
}
