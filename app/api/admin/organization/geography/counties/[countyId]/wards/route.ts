export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { organizationGeographyService } from '@/lib/services/organization-geography.service';
import { ok } from '@/lib/utils/response';

// countyId reaches a `WHERE g.county_id = $2` against a uuid column, so a
// malformed value would surface as a Postgres cast error (500) rather than a
// client error. Validating at the boundary keeps that a clean 400 — R14, same
// reasoning as programs/[id]/groups/route.ts.
const ParamsSchema = z.object({ countyId: z.string().uuid('Invalid county id') });

/**
 * GET /api/admin/organization/geography/counties/:countyId/wards — ward
 * breakdown within one county, scoped to this organization's own linked
 * groups. Row drill-down for the counties table above.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ countyId: string }> }): Promise<Response> {
  return withOrganizationAccess(req, 'organization.dashboard.view', async (auth) => {
    const { countyId } = ParamsSchema.parse(await params);
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const wards = await organizationGeographyService.getWardAggregation(ctx, countyId);
    return ok({ wards });
  });
}
