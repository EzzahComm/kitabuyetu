export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { campaignsService } from '@/lib/services/campaigns.service';
import { SetPayoutPhoneSchema } from '@/lib/validators/campaign.schema';
import { ok, handleError } from '@/lib/utils/response';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withAuth(req, async (auth) => {
    const { id } = await params;
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const campaign = await campaignsService.getGroupCampaignById(ctx, id);
    return ok(campaign);
  });
}

/** PATCH — set the payout phone (draft only; campaigns.service.ts's own
 *  guard is the real enforcement, this route is just the wire-up). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  return withPermission(req, 'campaigns.manage', async (auth) => {
    try {
      const input = SetPayoutPhoneSchema.parse(await req.json());
      const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
      return ok(await campaignsService.setPayoutPhone(ctx, id, input.payoutPhone));
    } catch (err) {
      return handleError(err);
    }
  });
}
