export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { analyticsService } from '@/lib/services/analytics.service';
import { AnalyticsQuerySchema } from '@/lib/validators/analytics.schema';
import { ok } from '@/lib/utils/response';

/**
 * GET /api/v1/analytics/executive?period=30d|90d|12mo|all
 * Returns the full executive-dashboard bundle in one call. All aggregations
 * run in parallel on the DB side, so the latency is dominated by the
 * slowest of ~15 single-row scans.
 */
export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx    = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const parsed = AnalyticsQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const result = await analyticsService.getExecutiveSummary(ctx, parsed.period);
    return ok(result);
  });
}
