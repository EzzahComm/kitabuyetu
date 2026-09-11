export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { creditScoresService } from '@/lib/services/credit-scores.service';
import { ScoreHistoryQuerySchema } from '@/lib/validators/credit-scores.schema';
import { ok } from '@/lib/utils/response';

interface RouteParams { params: Promise<{ memberId: string }> }

/** GET /api/v1/credit-scores/[memberId]/history — historical snapshots (newest first). */
export async function GET(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const { memberId } = await params;
  return withAuth(req, async (auth) => {
    const ctx    = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const parsed = ScoreHistoryQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const items  = await creditScoresService.getHistoryForMember(ctx, memberId, parsed);
    return ok({ items });
  });
}
