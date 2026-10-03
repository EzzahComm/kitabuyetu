export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { organizationHealthService } from '@/lib/services/organization-health.service';
import { ok } from '@/lib/utils/response';

/**
 * GET /api/admin/organization/health — portfolio risk indicators: loans past
 * due, groups in arrears, defaults, and membership movement.
 *
 * The "what needs attention?" half of §1.5, served separately from
 * /organization/dashboard (the "what is happening?" half) so that a failure in
 * either cannot blank the other — the same per-section independence R10 asks
 * for, at the route level.
 *
 * Lives under /api/admin/* because an organization coordinator holds a
 * BACKOFFICE token, which proxy.ts rejects on /api/v1/*.
 *
 * R10: `health: null` with `incomplete: ['health']` when the aggregate could
 * not be read. "No arrears" and "could not check for arrears" must never render
 * the same way, so the UI shows a dash and says so rather than implying zero
 * risk.
 */
export async function GET(req: NextRequest): Promise<Response> {
  return withOrganizationAccess(req, 'organization.dashboard.view', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const health = await organizationHealthService.getPortfolioHealth(ctx);
    return ok({ health, incomplete: health ? [] : ['health'] });
  });
}
