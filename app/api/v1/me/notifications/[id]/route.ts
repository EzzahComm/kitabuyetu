export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { markNotificationRead } from '@/lib/services/member-notifications.service';
import { ok } from '@/lib/utils/response';

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/v1/me/notifications/[id] — mark one of the signed-in member's own notifications read. */
export async function PATCH(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withAuth(req, async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    await markNotificationRead(ctx, id);
    return ok({ id });
  });
}
