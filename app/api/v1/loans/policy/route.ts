export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth, withRole } from '@/lib/auth/middleware';
import { loanPolicyService } from '@/lib/services/loan-policy.service';
import { SetLoanTermsSchema } from '@/lib/validators/loan.schema';
import { ok } from '@/lib/utils/response';

/**
 * GET /api/v1/loans/policy — this group's effective loan terms (default
 *   interest rate/method, max term, loan multiplier) with resolution source.
 *   Any authenticated member can read: the loan-application form uses these
 *   as its advisory defaults.
 * PUT /api/v1/loans/policy — set a group-level override. Chairperson only —
 *   this changes the group's default lending terms.
 */

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    return ok(await loanPolicyService.getGroupTerms(ctx));
  });
}

export async function PUT(req: NextRequest): Promise<Response> {
  return withRole(req, 'chairperson', async (auth) => {
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const input = SetLoanTermsSchema.parse(await req.json());
    await loanPolicyService.setGroupTermsOverride(ctx, input);
    return ok(await loanPolicyService.getGroupTerms(ctx));
  });
}
