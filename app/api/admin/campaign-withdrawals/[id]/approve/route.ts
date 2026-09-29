export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { campaignWithdrawalsService } from '@/lib/services/campaign-withdrawals.service';
import { ok } from '@/lib/utils/response';

/** POST /api/admin/campaign-withdrawals/[id]/approve — awaiting_platform -> approved, then dispatched. Super-admin only. */
export function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async (ctx) => {
    const { id } = await params;
    return ok(await campaignWithdrawalsService.platformApprove(ctx.userId, id));
  });
}
