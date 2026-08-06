export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOrganizationPermission } from '@/lib/auth/middleware';
import { organizationFinanceService } from '@/lib/services/organization-finance.service';
import { DisburseSchema } from '@/lib/validators/organization.schema';
import { ok } from '@/lib/utils/response';

/**
 * GET  /api/v1/organization/disbursements — list org → group disbursements
 * POST /api/v1/organization/disbursements — disburse funds to a linked group
 *
 * The service enforces: coordinator role, active organization_group_access
 * link, sufficient wallet balance, program budget ceiling, and posts the
 * dual ledger (org ledger + group journal) atomically.
 */

export async function GET(req: NextRequest): Promise<Response> {
  return withOrganizationPermission(req, 'organization.disbursements.manage', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const page  = parseInt(req.nextUrl.searchParams.get('page')  ?? '1', 10);
    const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '25', 10);
    return ok(await organizationFinanceService.listDisbursements(ctx, { page, limit }));
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return withOrganizationPermission(req, 'organization.disbursements.manage', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const input = DisburseSchema.parse(await req.json());
    return ok(await organizationFinanceService.disburse(ctx, input), 201);
  });
}
