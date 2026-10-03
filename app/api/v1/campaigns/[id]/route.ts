export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { campaignsService } from '@/lib/services/campaigns.service';
import { SetPayoutDestinationSchema } from '@/lib/validators/campaign.schema';
import { ok, handleError } from '@/lib/utils/response';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withAuth(req, async (auth) => {
    const { id } = await params;
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const campaign = await campaignsService.getGroupCampaignById(ctx, id);
    return ok(campaign);
  });
}

/** PATCH - set the payout destination: phone, paybill or till (draft only;
 *  campaigns.service.ts's own guard is the real enforcement, this route is
 *  just the wire-up). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  return withPermission(req, 'campaigns.manage', async (auth) => {
    try {
      const destination = SetPayoutDestinationSchema.parse(await req.json());
      const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
      return ok(await campaignsService.setPayoutDestination(ctx, id, destination));
    } catch (err) {
      return handleError(err);
    }
  });
}
