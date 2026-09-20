export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { getMarketingAnalytics } from '@/lib/services/marketing-analytics.service';
import { ok } from '@/lib/utils/response';

export async function GET(request: NextRequest): Promise<Response> {
  return withPermission(request, 'crm.view', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const daysParam = new URL(request.url).searchParams.get('days');
    const analytics = await getMarketingAnalytics(ctx, daysParam ? Number(daysParam) : undefined);
    return ok(analytics);
  });
}
