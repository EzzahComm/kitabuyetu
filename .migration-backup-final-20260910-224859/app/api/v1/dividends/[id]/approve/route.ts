export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { dividendsService } from '@/lib/services/dividends.service';
import { ok } from '@/lib/utils/response';

interface RouteParams { params: Promise<{ id: string }> }

/**
 * POST /api/v1/dividends/[id]/approve — snapshots holdings, computes and
 * persists allocations, marks the declaration approved. Group admin only —
 * approval is the board-sign-off moment, even though treasurer can draft.
 */
export async function POST(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const { id } = await params;
  return withPermission(req, 'dividends.approve', async (auth) => {
    const result = await dividendsService.approve(
      { userId: auth.userId, groupId: auth.groupId, role: auth.role }, id,
    );
    return ok(result);
  });
}
