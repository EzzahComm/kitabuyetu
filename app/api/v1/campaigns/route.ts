export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission, withAuth } from '@/lib/auth/middleware';
import { campaignsService } from '@/lib/services/campaigns.service';
import { CreateCampaignSchema } from '@/lib/validators/campaign.schema';
import { ok, created } from '@/lib/utils/response';

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const campaigns = await campaignsService.listGroupCampaigns(ctx);
    return ok(campaigns);
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return withPermission(req, 'campaigns.manage', async (auth) => {
    const body  = await req.json();
    const input = CreateCampaignSchema.parse(body);
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const campaign = await campaignsService.createCampaign(ctx, input);
    return created(campaign);
  });
}
