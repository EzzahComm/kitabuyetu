import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok } from '@/lib/utils/response';
import { getPlatformStats, getRevenueTrend } from '@/lib/services/admin.service';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  return withPlatformRole(req, 'super_admin', async () => {
    const url    = new URL(req.url);
    const widget = url.searchParams.get('widget');

    if (widget === 'revenue_trend') {
      const data = await getRevenueTrend();
      return ok(data);
    }

    const data = await getPlatformStats();
    return ok(data);
  });
}
