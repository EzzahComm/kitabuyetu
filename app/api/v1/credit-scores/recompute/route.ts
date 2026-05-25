export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth/middleware';
import { creditScoresService } from '@/lib/services/credit-scores.service';
import { ok } from '@/lib/utils/response';

/**
 * POST /api/v1/credit-scores/recompute — sweep all active members and write
 * a fresh score snapshot per member. Restricted to group_admin: this is a
 * potentially expensive batch operation and changes scoring for everyone.
 */
export async function POST(req: NextRequest): Promise<Response> {
  return withRole(req, 'group_admin', async (auth) => {
    const result = await creditScoresService.recomputeAll(
      { userId: auth.userId, groupId: auth.groupId, role: auth.role },
    );
    return ok(result);
  });
}
