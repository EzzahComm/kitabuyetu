import { withAdminDb } from '@/lib/db';
import type { PoolClient } from 'pg';

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
          COUNT(*) FILTER (WHERE status = 'active') AS active,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS new_this_month
        FROM public.members
      `),
      db.query(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status = 'active') AS active,
          COUNT(*) FILTER (WHERE status = 'expired' OR status = 'suspended') AS at_risk,
          SUM(CASE WHEN status = 'active' AND plan = 'growth' THEN 1000
                   WHEN status = 'active' AND plan = 'enterprise' THEN 8000 ELSE 0 END) AS mrr
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
          action, table_name, created_at,
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
      conditions.push(`s.plan = $${idx}`);
      values.push(plan); idx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [data, count] = await Promise.all([
      db.query(`
        SELECT
          g.id, g.name, g.group_type, g.onboarding_status,
          g.risk_score, g.engagement_score, g.created_at,
          g.suspended_at, g.suspended_reason,
          COALESCE(s.plan, 'starter') AS plan,
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
        GROUP BY g.id, s.plan, s.status
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
        SELECT g.*, s.plan, s.status AS subscription_status,
               s.current_period_end, s.trial_ends_at,
               m.first_name || ' ' || m.last_name AS admin_name,
               m.phone_number AS admin_phone, m.email AS admin_email
        FROM public.groups g
        LEFT JOIN public.subscriptions s ON s.group_id = g.id AND s.status IN ('active','trial')
        LEFT JOIN public.group_members gm ON gm.group_id = g.id AND gm.role = 'group_admin'
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
        SELECT action, table_name, created_at
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
      conds.push(`(m.first_name ILIKE $${idx} OR m.last_name ILIKE $${idx} OR m.email ILIKE $${idx} OR m.phone_number ILIKE $${idx})`);
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
          m.id, m.first_name, m.last_name, m.email, m.phone_number,
          m.platform_role, m.status, m.created_at, m.last_login_at,
          gm.role AS group_role, g.name AS group_name
        FROM public.members m
        LEFT JOIN public.group_members gm ON gm.member_id = m.id AND gm.status = 'active'
        LEFT JOIN public.groups g ON g.id = gm.group_id
        ${where}
        ORDER BY m.created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `, [...vals, limit, offset]),
      db.query(`SELECT COUNT(DISTINCT m.id) AS total FROM public.members m LEFT JOIN public.group_members gm ON gm.member_id = m.id ${where}`, vals),
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
          SUM(CASE WHEN status = 'active' AND plan = 'growth'     THEN 1000
                   WHEN status = 'active' AND plan = 'enterprise' THEN 8000 ELSE 0 END) AS mrr,
          COUNT(*) FILTER (WHERE current_period_end < NOW() AND status = 'active') AS overdue_count
        FROM public.subscriptions
      `),
      db.query(`
        SELECT plan, COUNT(*) AS count,
          SUM(CASE WHEN plan = 'growth' THEN 1000 WHEN plan = 'enterprise' THEN 8000 ELSE 0 END) AS revenue
        FROM public.subscriptions WHERE status = 'active'
        GROUP BY plan ORDER BY revenue DESC
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
        SELECT i.id, i.invoice_number, i.amount_due, i.due_date, i.status,
               g.name AS group_name
        FROM public.invoices i
        LEFT JOIN public.groups g ON g.id = i.group_id
        WHERE i.status IN ('pending','overdue')
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
    if (tbl)     { conds.push(`al.table_name = $${idx}`);                  vals.push(tbl);     idx++; }
    if (search)  { conds.push(`al.table_name ILIKE $${idx}`);              vals.push(`%${search}%`); idx++; }
    if (from)    { conds.push(`al.created_at >= $${idx}`);                 vals.push(from);    idx++; }
    if (to)      { conds.push(`al.created_at <= $${idx}`);                 vals.push(to);      idx++; }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const [data, count] = await Promise.all([
      db.query(`
        SELECT al.*, g.name AS group_name,
               m.first_name || ' ' || m.last_name AS actor_name
        FROM public.audit_logs al
        LEFT JOIN public.groups g ON g.id = al.group_id
        LEFT JOIN public.members m ON m.id = al.performed_by
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
        SELECT g.id, g.name, g.group_type,
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
