export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { markAllNotificationsRead } from '@/lib/services/member-notifications.service';
import { ok } from '@/lib/utils/response';

/** POST /api/v1/me/notifications/mark-all-read — marks all of the signed-in member's own notifications read. */
export async function POST(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    await markAllNotificationsRead(ctx);
    return ok({ status: 'ok' });
  });
}
