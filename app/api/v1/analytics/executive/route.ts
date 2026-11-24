export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { analyticsService } from '@/lib/services/analytics.service';
import { AnalyticsQuerySchema } from '@/lib/validators/analytics.schema';
import { ok } from '@/lib/utils/response';

/**
 * GET /api/v1/analytics/executive?period=30d|90d|12mo|all
 * Returns the executive dashboard bundle for users with analytics.view.
 */
export async function GET(req: NextRequest): Promise<Response> {
  return withPermission(req, 'analytics.view', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const parsed = AnalyticsQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const result = await analyticsService.getExecutiveSummary(ctx, parsed.period);
    return ok(result);
  });
}
