export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { rejectCampaign } from '@/lib/services/marketing-campaigns.service';
import { ok, badRequest } from '@/lib/utils/response';

export async function POST(request: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return withPermission(request, 'crm.manage', async (auth) => {
    const body = await request.json();
    const { reason } = body;
    if (!reason || typeof reason !== 'string' || !reason.trim()) return badRequest('A rejection reason is required');

    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const campaign = await rejectCampaign(ctx, params.id, reason);
    return ok(campaign);
  });
}
