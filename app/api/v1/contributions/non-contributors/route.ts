export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth/middleware';
import { contributionsService } from '@/lib/services/contributions.service';
import { ok, handleError } from '@/lib/utils/response';

/** GET /api/v1/contributions/non-contributors — active members with no completed
 *  contribution this month (treasurer+). Returns { count, sample[] }. */
export async function GET(req: NextRequest): Promise<Response> {
  return withRole(req, 'treasurer', async (auth) => {
    try {
      const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
      return ok(await contributionsService.nonContributors(ctx));
    } catch (err) {
      return handleError(err);
    }
  });
}
