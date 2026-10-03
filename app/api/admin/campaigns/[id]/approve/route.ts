export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { campaignsService } from '@/lib/services/campaigns.service';
import { ok } from '@/lib/utils/response';

/** POST /api/admin/campaigns/[id]/approve — pending_review -> active. Super-admin only. */
export function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async (ctx) => {
    const { id } = await params;
    const campaign = await campaignsService.approveCampaign(ctx.userId, id);
    return ok(campaign);
  });
}
