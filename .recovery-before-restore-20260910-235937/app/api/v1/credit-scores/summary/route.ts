export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { creditScoresService } from '@/lib/services/credit-scores.service';
import { ok } from '@/lib/utils/response';

/** GET /api/v1/credit-scores/summary — group-wide tier distribution + averages. */
export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const summary = await creditScoresService.getGroupSummary(
      { userId: auth.userId, groupId: auth.groupId, role: auth.role },
    );
    return ok(summary);
  });
}
