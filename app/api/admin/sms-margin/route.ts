import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok } from '@/lib/utils/response';
import { smsMarginService } from '@/lib/services/sms-margin.service';

export const dynamic = 'force-dynamic';

/**
 * SMS revenue and margin (spec §15). INTERNAL ONLY.
 *
 * super_admin alone, not support: this discloses what Kitabu Yetu pays the
 * provider, which §15 says never reaches a customer and which support staff
 * have no operational need for. It lives under /api/admin/* so the proxy
 * requires a backoffice token before the handler is even reached — a tenant
 * token cannot arrive here at all.
 */
export function GET(req: NextRequest) {
  return withPlatformRole(req, 'super_admin', async () => {
    const p = new URL(req.url).searchParams;
    const [summary, byPackage, topCustomers, tiers] = await Promise.all([
      smsMarginService.getMarginSummary(p.get('from') ?? undefined, p.get('to') ?? undefined),
      smsMarginService.getRevenueByPackage(),
      smsMarginService.getTopCustomers(),
      smsMarginService.getTierViability(),
    ]);
    return ok({ summary, byPackage, topCustomers, tiers });
  });
}
