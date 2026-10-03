export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { organizationFinanceService } from '@/lib/services/organization-finance.service';
import { ok } from '@/lib/utils/response';

/**
 * GET /api/v1/organization/dashboard — financial + portfolio metrics for the
 * organization ecosystem dashboard (wallet position, linked-group aggregates,
 * active programs).
 */
export async function GET(req: NextRequest): Promise<Response> {
  return withOrganizationAccess(req, 'organization.dashboard.view', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    return ok(await organizationFinanceService.getDashboard(ctx));
  });
}
