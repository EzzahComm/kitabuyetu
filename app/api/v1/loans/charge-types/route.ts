export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { loanChargesService } from '@/lib/services/loan-charges.service';
import { ConfigureChargeTypeSchema } from '@/lib/validators/loan-charge.schema';
import { ok } from '@/lib/utils/response';

/**
 * GET  /api/v1/loans/charge-types — this group's effective loan-charge
 *   catalogue (processing fee, insurance fee, late payment fee, …), cascade-
 *   resolved Platform -> Organization -> Group exactly like GET /loans/policy.
 *   Any authenticated member can read: the loan-application/disbursement UI
 *   uses this to show what will be charged.
 * PUT  /api/v1/loans/charge-types — create or update a group-level charge
 *   type. Chairperson only (loans.policy.manage — the same permission that
 *   already gates the group's default lending terms), since this is
 *   configuration, not a per-loan operational action.
 *
 * A sibling resource to /loans/policy rather than folded into it: a charge
 * type is a named, individually addressable row (loan_charges references it
 * by id), not a single terms document — see migration 179's header.
 */

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    return ok(await loanChargesService.listChargeTypes(ctx));
  });
}

export async function PUT(req: NextRequest): Promise<Response> {
  return withPermission(req, 'loans.policy.manage', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const input = ConfigureChargeTypeSchema.parse(await req.json());
    return ok(await loanChargesService.configureChargeType(ctx, input));
  });
}
