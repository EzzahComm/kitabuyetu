export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { creditScoresService } from '@/lib/services/credit-scores.service';
import { CreditScoreQuerySchema } from '@/lib/validators/credit-scores.schema';
import { ok } from '@/lib/utils/response';

/** GET /api/v1/credit-scores — list latest score per member. */
export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx    = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const params = CreditScoreQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const result = await creditScoresService.listLatest(ctx, params);
    return ok(result);
  });
}
