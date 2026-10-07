import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok } from '@/lib/utils/response';
import {
  getPlatformStats,
  getRevenueTrend,
  getRiskDashboardData,
  getMonitoringDashboardData,
} from '@/lib/services/admin.service';
import { canViewPlatformFinance, redactPlatformStatsForRole } from '@/lib/services/platform-revenue-classification';
import { ForbiddenError } from '@/lib/utils/errors';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  return withPlatformRole(req, ['super_admin', 'support'], async (ctx) => {
    const url = new URL(req.url);
    const widget = url.searchParams.get('widget');

    if (widget === 'revenue_trend') {
      if (!canViewPlatformFinance(ctx.platformRole)) {
        throw new ForbiddenError('Revenue trend is restricted to super_admin');
      }
      const data = await getRevenueTrend();
      return ok(data);
    }

    if (widget === 'risk_dashboard') {
      const data = await getRiskDashboardData();
      return ok(data);
    }

    if (widget === 'monitoring_dashboard') {
      const data = await getMonitoringDashboardData();
      return ok(data);
    }

    const data = await getPlatformStats();
    return ok(redactPlatformStatsForRole(data, ctx.platformRole));
  });
}
