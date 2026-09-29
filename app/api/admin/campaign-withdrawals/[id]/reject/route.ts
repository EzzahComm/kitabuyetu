export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { campaignWithdrawalsService } from '@/lib/services/campaign-withdrawals.service';
import { RejectCampaignSchema } from '@/lib/validators/campaign.schema';
import { ok } from '@/lib/utils/response';

/** POST /api/admin/campaign-withdrawals/[id]/reject — awaiting_platform -> rejected, reserve released. Super-admin only. */
export function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async (ctx) => {
    const { id } = await params;
    const { reason } = RejectCampaignSchema.parse(await req.json());
    return ok(await campaignWithdrawalsService.platformReject(ctx.userId, id, reason));
  });
}
