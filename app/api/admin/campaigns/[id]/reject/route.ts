export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { campaignsService } from '@/lib/services/campaigns.service';
import { RejectCampaignSchema } from '@/lib/validators/campaign.schema';
import { ok } from '@/lib/utils/response';

/** POST /api/admin/campaigns/[id]/reject — pending_review -> rejected. Super-admin only. */
export function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async (ctx) => {
    const { id } = await params;
    const { reason } = RejectCampaignSchema.parse(await req.json());
    const campaign = await campaignsService.rejectCampaign(ctx.userId, id, reason);
    return ok(campaign);
  });
}
