export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { listRecentActivity } from '@/lib/services/crm.service';
import { ok } from '@/lib/utils/response';

export async function GET(request: NextRequest): Promise<Response> {
  return withPermission(request, 'crm.view', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const limitParam = new URL(request.url).searchParams.get('limit');
    const activities = await listRecentActivity(ctx, limitParam ? Number(limitParam) : undefined);
    return ok(activities);
  });
}
