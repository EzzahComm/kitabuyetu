export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { publishOpportunity } from '@/lib/services/ecosystem.service';
import { ok } from '@/lib/utils/response';

export async function PUT(request: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return withPermission(request, 'admin', async (auth) => {
    const ctx = { organizationId: auth.organizationId, userId: auth.userId, ipAddress: request.ip };
    const opportunity = await publishOpportunity(ctx, params.id);
    return ok(opportunity);
  });
}
