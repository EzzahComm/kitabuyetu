export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { campaignsService } from '@/lib/services/campaigns.service';
import { ok } from '@/lib/utils/response';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPermission(req, 'campaigns.manage', async (auth) => {
    const { id } = await params;
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const campaign = await campaignsService.submitForReview(ctx, id);
    return ok(campaign);
  });
}
