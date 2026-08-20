export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { getOrganizationPlanForCoordinator } from '@/lib/services/organization-plan.service';
import { ok } from '@/lib/utils/response';

/**
 * GET /api/v1/organization/plan — this organization's own current plan.
 * Read-only, real RLS (getOrganizationPlanForCoordinator uses withDb, not the
 * admin pool) — there is no self-serve change here, only super_admin assigns
 * or changes a plan (/api/admin/organizations/[id]/plan).
 */
export async function GET(req: NextRequest): Promise<Response> {
  return withOrganizationAccess(req, 'organization.plan.view', async (ctx) => {
    return ok(await getOrganizationPlanForCoordinator(ctx));
  });
}
