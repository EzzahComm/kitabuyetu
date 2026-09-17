export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { campaignsService } from '@/lib/services/campaigns.service';
import { ok } from '@/lib/utils/response';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withAuth(req, async (auth) => {
    const { id } = await params;
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const donations = await campaignsService.listDonationsForCampaign(ctx, id);
    return ok(donations);
  });
}
