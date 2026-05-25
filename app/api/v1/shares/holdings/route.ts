export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { sharesService } from '@/lib/services/shares.service';
import { HoldingsQuerySchema } from '@/lib/validators/shares.schema';
import { ok } from '@/lib/utils/response';

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx    = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const params = HoldingsQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const result = await sharesService.listHoldings(ctx, params);
    return ok(result);
  });
}
