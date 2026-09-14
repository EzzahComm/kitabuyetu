export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { organizationFinanceService } from '@/lib/services/organization-finance.service';
import { ok } from '@/lib/utils/response';

/**
 * GET /api/admin/organization/programs/:id/groups — the groups this funding
 * program has actually moved money to. Programme tier of the portfolio
 * drill-down (Org → Programme → Group → Member).
 *
 * Lives under /api/admin/* and not /api/v1/*: an organization coordinator holds
 * a BACKOFFICE token, and proxy.ts rejects backoffice tokens on /api/v1/* by
 * audience. (Sibling route files still describe themselves as /api/v1/... in
 * their comments — stale from before that move.)
 *
 * Gated on organization.dashboard.view rather than organization.groups.view:
 * this is the portfolio drill-down surface, so if those tiers are ever split a
 * read-only portfolio viewer should keep it. Both admit exactly
 * organization_coordinator | super_admin today.
 */

// The id reaches a `WHERE id = $1` against a uuid column, so a malformed value
// would surface as a Postgres cast error (500) rather than a client error.
// Validating at the boundary keeps that a clean 400 — R14.
const ParamsSchema = z.object({ id: z.string().uuid('Invalid program id') });

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withOrganizationAccess(req, 'organization.dashboard.view', async (auth) => {
    const { id } = ParamsSchema.parse(await params);
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    return ok(await organizationFinanceService.listProgramGroups(ctx, id));
  });
}
