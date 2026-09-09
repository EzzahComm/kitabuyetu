import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok } from '@/lib/utils/response';
import {
  getPlatformStats,
  getRevenueTrend,
  getRiskDashboardData,
  getMonitoringDashboardData,
} from '@/lib/services/admin.service';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  return withPlatformRole(req, ['super_admin', 'support'], async () => {
    const url    = new URL(req.url);
    const widget = url.searchParams.get('widget');

    if (widget === 'revenue_trend') {
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
    return ok(data);
  });
}
