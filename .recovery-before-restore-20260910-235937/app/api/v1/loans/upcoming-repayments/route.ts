export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { loansService } from '@/lib/services/loans.service';
import { ok } from '@/lib/utils/response';

/** GET /api/v1/loans/upcoming-repayments — next N unpaid installments due across the group, soonest first. */
export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '5', 10);
    return ok(await loansService.listUpcomingRepayments(ctx, limit));
  });
}
