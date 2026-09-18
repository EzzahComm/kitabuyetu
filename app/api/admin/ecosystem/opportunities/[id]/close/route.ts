export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { closeOpportunity } from '@/lib/services/ecosystem.service';
import { ok } from '@/lib/utils/response';

export async function PUT(request: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return withPlatformRole(request, 'super_admin', async (ctx) => {
    const opportunity = await closeOpportunity({ userId: ctx.userId }, params.id);
    return ok(opportunity);
  });
}
