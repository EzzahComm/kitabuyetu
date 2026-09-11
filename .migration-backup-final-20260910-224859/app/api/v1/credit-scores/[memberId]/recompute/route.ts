export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { creditScoresService } from '@/lib/services/credit-scores.service';
import { ok } from '@/lib/utils/response';

interface RouteParams { params: Promise<{ memberId: string }> }

/** POST /api/v1/credit-scores/[memberId]/recompute — recompute for one. */
export async function POST(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const { memberId } = await params;
  return withPermission(req, 'credit_scores.recompute', async (auth) => {
    const score = await creditScoresService.recomputeForMember(
      { userId: auth.userId, groupId: auth.groupId, role: auth.role }, memberId,
    );
    return ok(score);
  });
}
