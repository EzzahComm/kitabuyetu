/** Read side of the platform activity log, for the super-admin dashboard. */
import { withAdminDb } from '@/lib/db';
import { enqueueDeliveryJob, formatRef } from './notification-queue';
import type { NotificationSeverity } from './notification-types';

export interface ActivityFilters {
  page?: number;
  limit?: number;
  eventType?: string;
  severity?: string;
  organizationId?: string;
  groupId?: string;
  userId?: string;
  /** Matches transaction id or reference. */
  transaction?: string;
  status?: string;
  from?: string;
  to?: string;
  channel?: 'sms' | 'email';
  failedOnly?: boolean;
}

export interface ActivityListRow {
  id: string;
  ref: string;
  event_type: string;
  severity: NotificationSeverity;
  title: string;
  description: string | null;
  actor: { name?: string; email?: string; phone?: string; role?: string } | null;
  organization_name: string | null;
  group_name: string | null;
  reference: string | null;
  amount: string | null;
  currency: string | null;
  status: string | null;
  aggregate: boolean;
  created_at: string;
  deliveries: {
    id: string;
    ref: string;
    channel: string;
    recipient: string;
    status: string;
    attempt_count: number;
    error_message: string | null;
    sent_at: string | null;
  }[];
}

export async function listActivity(f: ActivityFilters) {
  const page = Math.max(1, f.page ?? 1);
  const limit = Math.min(100, Math.max(1, f.limit ?? 50));
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace('?', `$${params.length}`));
  };

  if (f.eventType) add('a.event_type = ?', f.eventType);
  if (f.severity) add('a.severity = ?', f.severity);
  if (f.organizationId) add('a.organization_id = ?', f.organizationId);
  if (f.groupId) add('a.group_id = ?', f.groupId);
  if (f.userId) add('a.actor_user_id = ?', f.userId);
  if (f.status) add('a.status = ?', f.status);
  if (f.transaction) {
    params.push(`%${f.transaction}%`);
    where.push(`(a.transaction_id ILIKE $${params.length} OR a.reference ILIKE $${params.length})`);
  }
  if (f.from) add('a.created_at >= ?::timestamptz', f.from);
  if (f.to) add("a.created_at < (?::date + INTERVAL '1 day')", f.to);
  if (f.channel)
    add('EXISTS (SELECT 1 FROM notification_deliveries d WHERE d.activity_id = a.id AND d.channel = ?)', f.channel);
  if (f.failedOnly)
    where.push(
      "EXISTS (SELECT 1 FROM notification_deliveries d WHERE d.activity_id = a.id AND d.status IN ('FAILED','RETRYING'))",
    );

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  return withAdminDb(async (db) => {
    const { rows: count } = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM platform_activity_logs a ${whereSql}`,
      params,
    );
    const { rows } = await db.query<
      Omit<ActivityListRow, 'ref' | 'deliveries'> & {
        seq: string;
        deliveries: (ActivityListRow['deliveries'][number] & { seq: string; created_at: string })[];
      }
    >(
      `SELECT a.id, a.seq, a.event_type, a.severity, a.title, a.description, a.actor, a.organization_name,
              a.group_name, a.reference, a.amount, a.currency, a.status, a.aggregate, a.created_at,
              COALESCE((
                SELECT json_agg(json_build_object(
                         'id', d.id, 'seq', d.seq, 'created_at', d.created_at, 'channel', d.channel,
                         'recipient', d.recipient, 'status', d.status, 'attempt_count', d.attempt_count,
                         'error_message', d.error_message, 'sent_at', d.sent_at) ORDER BY d.created_at)
                FROM notification_deliveries d WHERE d.activity_id = a.id), '[]'::json) AS deliveries
       FROM   platform_activity_logs a
       ${whereSql}
       ORDER  BY a.created_at DESC
       LIMIT  ${limit} OFFSET ${(page - 1) * limit}`,
      params,
    );
    const total = Number(count[0]?.n ?? 0);
    const items: ActivityListRow[] = rows.map((r) => ({
      ...r,
      ref: formatRef('ACT', r.created_at, r.seq),
      deliveries: r.deliveries.map((d) => ({
        id: d.id,
        ref: formatRef(d.channel === 'sms' ? 'SMS' : 'EMAIL', d.created_at, d.seq),
        channel: d.channel,
        recipient: d.recipient,
        status: d.status,
        attempt_count: d.attempt_count,
        error_message: d.error_message,
        sent_at: d.sent_at,
      })),
    }));
    return { items, total, page, pageSize: limit, totalPages: Math.ceil(total / limit) };
  });
}

/** Re-arm a FAILED delivery for another round of attempts. */
export async function retryDelivery(deliveryId: string): Promise<boolean> {
  const row = await withAdminDb(async (db) => {
    const { rows } = await db.query<{ severity: NotificationSeverity }>(
      `UPDATE notification_deliveries d
       SET    status = 'PENDING', attempt_count = 0, error_message = NULL, updated_at = NOW()
       FROM   platform_activity_logs a
       WHERE  d.id = $1 AND d.status = 'FAILED' AND a.id = d.activity_id
       RETURNING a.severity`,
      [deliveryId],
    );
    return rows[0] ?? null;
  });
  if (!row) return false;
  await enqueueDeliveryJob(deliveryId, row.severity);
  return true;
}
