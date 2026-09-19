export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { getCampaignById } from '@/lib/services/marketing-campaigns.service';
import { ok, notFound } from '@/lib/utils/response';

export async function GET(request: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return withPermission(request, 'crm.view', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const campaign = await getCampaignById(ctx, params.id);
    if (!campaign) return notFound('Campaign not found');
    return ok(campaign);
  });
}
