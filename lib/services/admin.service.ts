import { withAdminDb } from '@/lib/db';
import type { PoolClient } from 'pg';

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
      type: (tx.transaction_type ?? 'C2B').toUpperCase().replace('C2B', 'C2B').replace('B2C', 'B2C').replace('STK', 'STK') as 'C2B' | 'B2C' | 'STK',
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
  return withAdminDb(async (db: PoolClient) => {
    const [groups, members, subscriptions, revenue, tickets, activity] = await Promise.all([
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
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE is_active = true) AS active,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS new_this_month
        FROM public.members
      `),
      db.query(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status = 'active') AS active,
          COUNT(*) FILTER (WHERE status = 'expired' OR status = 'suspended') AS at_risk,
          COALESCE(SUM(monthly_fee) FILTER (WHERE status = 'active'), 0) AS mrr
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
      members:       members.rows[0],
      subscriptions: subscriptions.rows[0],
      revenue:       revenue.rows[0],
      tickets:       tickets.rows[0],
      recentActivity: activity.rows,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Revenue trend (last 6 months)
// ─────────────────────────────────────────────────────────────────────────────
export async function getRevenueTrend() {
  return withAdminDb(async (db: PoolClient) => {
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
  });
}

export async function getRiskDashboardData(): Promise<RiskDashboardPayload> {
  return withAdminDb(async (db: PoolClient) => {
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
        lo AS (
          SELECT g.type::text AS segment,
                 COUNT(*) AS total,
                 COUNT(*) FILTER (WHERE COALESCE(l.days_in_arrears, 0) > 0) AS arrears
          FROM public.loans l
          JOIN public.groups g ON g.id = l.group_id
          GROUP BY g.type
        )
        SELECT g.type::text AS segment,
               ROUND(100.0 * COALESCE(MAX(txn.risky), 0) / NULLIF(MAX(txn.total), 0))::int AS fraud,
               ROUND(AVG(COALESCE(g.risk_score, 0)))::int                                  AS aml,
               ROUND(100.0 * COALESCE(MAX(lo.arrears), 0) / NULLIF(MAX(lo.total), 0))::int  AS credit,
               ROUND(AVG(COALESCE(g.risk_score, 0)))::int                                  AS liquidity,
               ROUND(100.0 * COUNT(*) FILTER (WHERE g.kyc_verified_at IS NULL) / NULLIF(COUNT(*), 0))::int AS compliance
        FROM public.groups g
        LEFT JOIN txn ON txn.segment = g.type::text
        LEFT JOIN lo  ON lo.segment  = g.type::text
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
        scores: [r.fraud, r.aml, r.credit, r.liquidity, r.compliance].map((n) => Number(n ?? 0)),
      })),
    });
  });
}

export async function getMonitoringDashboardData(): Promise<MonitoringDashboardPayload> {
  return withAdminDb(async (db: PoolClient) => {
    const [channels, smsHealth, hourly, smsUsage, transactions] = await Promise.all([
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
        ORDER BY created_at DESC
        LIMIT 12
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
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Organizations (all groups, cross-tenant)
// ─────────────────────────────────────────────────────────────────────────────
export interface OrgListParams {
  page:    number;
  limit:   number;
  search?: string;
  status?: string;
  plan?:   string;
}

export async function listOrganizations(params: OrgListParams) {
  return withAdminDb(async (db: PoolClient) => {
    const { page, limit, search, status, plan } = params;
    const offset = (page - 1) * limit;
    const conditions: string[] = [];
    const values: unknown[]    = [];
    let   idx = 1;

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
          g.risk_score, g.engagement_score, g.created_at,
          g.suspended_at, g.suspended_reason,
          COALESCE(s.plan_type, 'starter') AS plan,
          COALESCE(s.status, 'active') AS subscription_status,
          COUNT(DISTINCT gm.id)   AS member_count,
          COALESCE(SUM(DISTINCT c.amount) FILTER (WHERE c.status = 'completed'), 0) AS total_contributions,
          COALESCE(SUM(DISTINCT l.principal_amount) FILTER (WHERE l.status = 'active'), 0) AS active_loans
        FROM public.groups g
        LEFT JOIN public.subscriptions s ON s.group_id = g.id AND s.status = 'active'
        LEFT JOIN public.group_members gm ON gm.group_id = g.id AND gm.status = 'active'
        LEFT JOIN public.contributions c ON c.group_id = g.id
        LEFT JOIN public.loans l ON l.group_id = g.id
        ${where}
        GROUP BY g.id, s.plan_type, s.status
        ORDER BY g.created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `, [...values, limit, offset]),
      db.query(`
        SELECT COUNT(DISTINCT g.id) AS total
        FROM public.groups g
        LEFT JOIN public.subscriptions s ON s.group_id = g.id AND s.status = 'active'
        ${where}
      `, values),
    ]);

    return { items: data.rows, total: parseInt(count.rows[0].total, 10), page, limit };
  });
}

export async function getOrganizationById(groupId: string) {
  return withAdminDb(async (db: PoolClient) => {
    const [group, stats, recentActivity] = await Promise.all([
      db.query(`
        SELECT g.*, g.type AS group_type, s.plan_type AS plan, s.status AS subscription_status,
               s.expires_at AS current_period_end, s.next_billing_date AS trial_ends_at,
               m.first_name || ' ' || m.last_name AS admin_name,
               m.phone AS admin_phone, m.email AS admin_email
        FROM public.groups g
        LEFT JOIN public.subscriptions s ON s.group_id = g.id AND s.status IN ('active','trial')
        LEFT JOIN public.group_members gm ON gm.group_id = g.id AND gm.role = 'chairperson'
        LEFT JOIN public.members m ON m.id = gm.member_id
        WHERE g.id = $1
        LIMIT 1
      `, [groupId]),
      db.query(`
        SELECT
          COUNT(DISTINCT gm.id) FILTER (WHERE gm.status = 'active') AS active_members,
          COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'completed'), 0) AS total_contributions,
          COALESCE(SUM(l.principal_amount) FILTER (WHERE l.status = 'active'), 0)   AS active_loans_amount,
          COUNT(DISTINCT l.id)  FILTER (WHERE l.status = 'active')  AS active_loans_count,
          COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'completed'), 0) AS total_payments,
          COUNT(DISTINCT st.id) FILTER (WHERE st.status NOT IN ('resolved','closed')) AS open_tickets
        FROM public.groups g
        LEFT JOIN public.group_members gm ON gm.group_id = g.id
        LEFT JOIN public.contributions c ON c.group_id = g.id
        LEFT JOIN public.loans l ON l.group_id = g.id
        LEFT JOIN public.payments p ON p.group_id = g.id
        LEFT JOIN public.support_tickets st ON st.group_id = g.id
        WHERE g.id = $1
        GROUP BY g.id
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

export async function updateOrganizationStatus(
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
          COUNT(*) FILTER (WHERE status = 'active')  AS active_subscriptions,
          COUNT(*) FILTER (WHERE status = 'expired') AS expired_subscriptions,
          COUNT(*) FILTER (WHERE status = 'trial')   AS trial_subscriptions,
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
  return withAdminDb(async (db: PoolClient) => {
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
  });
}
