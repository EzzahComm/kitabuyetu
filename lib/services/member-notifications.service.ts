/**
 * Read-side for the (member) portal's in-app notifications list + bell
 * badge. Deliberately a separate file from notifications.service.ts, which
 * is the SMS/WhatsApp *dispatch* service (confusingly similar name, very
 * different job) — that file's notifyMember() is what now also writes the
 * rows this file reads.
 */
import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import type { PaginatedResult } from '@/types/db.types';

export interface MemberNotification {
  id:            string;
  type:          string;
  title:         string;
  body:          string;
  isRead:        boolean;
  referenceType: string | null;
  referenceId:   string | null;
  createdAt:     Date;
}

interface NotificationRow {
  id: string; type: string; title: string; body: string; is_read: boolean;
  reference_type: string | null; reference_id: string | null; created_at: Date;
}

function mapRow(r: NotificationRow): MemberNotification {
  return {
    id: r.id, type: r.type, title: r.title, body: r.body, isRead: r.is_read,
    referenceType: r.reference_type, referenceId: r.reference_id, createdAt: r.created_at,
  };
}

export async function listMyNotifications(
  ctx: TenantContext,
  params: { page: number; limit: number },
): Promise<PaginatedResult<MemberNotification> & { unreadCount: number }> {
  return withDb(ctx, async (client) => {
    const { page, limit } = params;
    const offset = (page - 1) * limit;

    const { rows: countRows } = await client.query<{ total: string; unread: string }>(
      `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE is_read = false) AS unread
       FROM notifications WHERE group_id = $1 AND member_id = $2`,
      [ctx.groupId, ctx.userId],
    );
    const total = parseInt(countRows[0].total, 10);
    const unreadCount = parseInt(countRows[0].unread, 10);

    const { rows } = await client.query<NotificationRow>(
      `SELECT id, type, title, body, is_read, reference_type, reference_id, created_at
       FROM notifications WHERE group_id = $1 AND member_id = $2
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [ctx.groupId, ctx.userId, limit, offset],
    );

    return {
      items: rows.map(mapRow), total, page, pageSize: limit, totalPages: Math.ceil(total / limit), unreadCount,
    };
  });
}

export async function markNotificationRead(ctx: TenantContext, id: string): Promise<void> {
  await withTransaction(ctx, async (client) => {
    // Fetch existing notification to capture old values
    const { rows: existing } = await client.query<{ is_read: boolean }>(
      `SELECT is_read FROM notifications WHERE id = $1 AND group_id = $2 AND member_id = $3`,
      [id, ctx.groupId, ctx.userId],
    );
    if (!existing[0]) return; // Not found or unauthorized, silently skip

    const prev = existing[0];

    await client.query(
      `UPDATE notifications SET is_read = true, read_at = NOW()
       WHERE id = $1 AND group_id = $2 AND member_id = $3`,
      [id, ctx.groupId, ctx.userId],
    );

    // Record audit log
    if (!prev.is_read) { // Only audit if status actually changed
      await client.query(
        `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          ctx.groupId,
          ctx.userId,
          'notification.read',
          'notification',
          id,
          JSON.stringify({ is_read: false }),
          JSON.stringify({ is_read: true }),
        ],
      );
    }
  });
}

export async function markAllNotificationsRead(ctx: TenantContext): Promise<void> {
  await withTransaction(ctx, async (client) => {
    // Fetch all unread notifications to log each transition
    const { rows: unread } = await client.query<{ id: string }>(
      `SELECT id FROM notifications WHERE group_id = $1 AND member_id = $2 AND is_read = false`,
      [ctx.groupId, ctx.userId],
    );

    await client.query(
      `UPDATE notifications SET is_read = true, read_at = NOW()
       WHERE group_id = $1 AND member_id = $2 AND is_read = false`,
      [ctx.groupId, ctx.userId],
    );

    // Record audit logs for each notification marked as read
    for (const notification of unread) {
      await client.query(
        `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          ctx.groupId,
          ctx.userId,
          'notification.read',
          'notification',
          notification.id,
          JSON.stringify({ is_read: false }),
          JSON.stringify({ is_read: true }),
        ],
      );
    }
  });
}
