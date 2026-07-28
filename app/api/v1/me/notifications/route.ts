export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/middleware';
import { listMyNotifications } from '@/lib/services/member-notifications.service';
import { ok } from '@/lib/utils/response';

const QuerySchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** GET /api/v1/me/notifications — the signed-in member's own notifications + unread count. */
export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const params = QuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const page = await listMyNotifications(ctx, params);
    return ok(page);
  });
}
