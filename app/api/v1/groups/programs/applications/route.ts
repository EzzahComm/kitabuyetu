export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { programApplicationsService } from '@/lib/services/program-applications.service';
import { ok } from '@/lib/utils/response';

/** GET /api/v1/groups/programs/applications - this group's own applications, every status */
export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return ok({ items: await programApplicationsService.listForGroup(ctx) });
  });
}
