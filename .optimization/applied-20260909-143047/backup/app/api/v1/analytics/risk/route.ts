export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { analyticsService } from '@/lib/services/analytics.service';
import { ok } from '@/lib/utils/response';

/**
 * GET /api/v1/analytics/risk — surfaces high-risk signals across the group:
 * overdue loans, defaulted/written-off loans, members in poor/high_risk
 * credit tiers, idle members (no contribution in 90+ days), and welfare
 * requests that have been pending > 14 days.
 *
 * Cap of 50 rows per category — this is a "who do I chase first" view,
 * not a paginated report. Drill-down filtered list views land in E8.3.
 */
export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const risk = await analyticsService.getRiskAnalysis(
      { userId: auth.userId, groupId: auth.groupId, role: auth.role },
    );
    return ok(risk);
  });
}
