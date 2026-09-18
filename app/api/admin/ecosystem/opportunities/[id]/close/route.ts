export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { closeOpportunity } from '@/lib/services/ecosystem.service';
import { ok } from '@/lib/utils/response';

export async function PUT(request: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return withPermission(request, 'admin', async (auth) => {
    const ctx = { userId: auth.userId, groupId: '', role: auth.role, organizationId: auth.organizationId };
    const opportunity = await closeOpportunity(ctx, params.id);
    return ok(opportunity);
  });
}
