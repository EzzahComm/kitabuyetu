export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { creditScoresService } from '@/lib/services/credit-scores.service';
import { ok } from '@/lib/utils/response';

interface RouteParams { params: Promise<{ memberId: string }> }

/** GET /api/v1/credit-scores/[memberId] — latest score for one member. */
export async function GET(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const { memberId } = await params;
  return withAuth(req, async (auth) => {
    const score = await creditScoresService.getLatestForMember(
      { userId: auth.userId, groupId: auth.groupId, role: auth.role }, memberId,
    );
    return ok(score);
  });
}
