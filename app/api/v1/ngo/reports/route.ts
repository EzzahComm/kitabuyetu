export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { ngoService } from '@/lib/services/ngo.service';
import { ok, errorResponse } from '@/lib/utils/response';

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const groupId = req.nextUrl.searchParams.get('groupId');
    if (!groupId) return errorResponse('groupId query param is required', 'VALIDATION_ERROR', 422);
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, ngoId: auth.ngoId };
    return ok(await ngoService.getGroupDetail(ctx, groupId));
  });
}
