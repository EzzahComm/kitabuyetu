export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { submitForReview } from '@/lib/services/marketing-campaigns.service';
import { ok } from '@/lib/utils/response';

export async function POST(request: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return withPermission(request, 'crm.manage', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const campaign = await submitForReview(ctx, params.id);
    return ok(campaign);
  });
}
