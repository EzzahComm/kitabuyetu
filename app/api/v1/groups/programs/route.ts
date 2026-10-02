export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { programsService } from '@/lib/services/programs.service';
import { ok } from '@/lib/utils/response';

/** GET /api/v1/groups/programs — published programs discoverable by any group, any member role can read */
export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return ok({ items: await programsService.listPublished(ctx) });
  });
}
