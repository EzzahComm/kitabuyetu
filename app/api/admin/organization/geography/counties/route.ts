export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { organizationGeographyService } from '@/lib/services/organization-geography.service';
import { ok } from '@/lib/utils/response';

/**
 * GET /api/admin/organization/geography/counties — county-level coverage
 * rollup (group/member counts, contributions, loan book) across this
 * organization's own linked groups. Organization-axis counterpart to the
 * platform-wide, super_admin-only /api/admin/geography/counties.
 *
 * Gated on organization.dashboard.view rather than a new permission, matching
 * programs/:id/groups's reasoning: this is portfolio drill-down territory
 * (the dashboard's "Savings by region" card), not a distinct permission tier.
 */
export async function GET(req: NextRequest): Promise<Response> {
  return withOrganizationAccess(req, 'organization.dashboard.view', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const counties = await organizationGeographyService.getCountyAggregation(ctx);
    return ok({ counties });
  });
}
