export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withOrganizationPermission } from '@/lib/auth/middleware';
import { organizationFinanceService } from '@/lib/services/organization-finance.service';
import { ok } from '@/lib/utils/response';

/**
 * GET  /api/v1/organization/disbursements — list org → group disbursements
 * POST /api/v1/organization/disbursements — disburse funds to a linked group
 *
 * The service enforces: coordinator role, active organization_group_access
 * link, sufficient wallet balance, program budget ceiling, and posts the
 * dual ledger (org ledger + group journal) atomically.
 */

const DISBURSEMENT_TYPES = [
  'grant', 'revolving_fund', 'loan_capital', 'matching_contribution',
  'seed_capital', 'emergency_support', 'operational_support',
] as const;

const DisburseSchema = z.object({
  groupId:          z.string().uuid(),
  amount:           z.number().positive().max(1_000_000_000),
  disbursementType: z.enum(DISBURSEMENT_TYPES),
  fundingProgramId: z.string().uuid().optional(),
  notes:            z.string().max(500).optional(),
});

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
