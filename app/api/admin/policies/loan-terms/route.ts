export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { withAdminDb } from '@/lib/db';
import { loanPolicyService } from '@/lib/services/loan-policy.service';
import { SetLoanTermsSchema } from '@/lib/validators/loan.schema';
import { ok } from '@/lib/utils/response';

/**
 * GET /api/admin/policies/loan-terms — platform-wide default loan terms.
 * PUT /api/admin/policies/loan-terms — set the platform-wide default (super_admin only).
 */

export async function GET(req: NextRequest): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async () => {
    return ok(await withAdminDb((client) => loanPolicyService.getPlatformTerms(client)));
  });
}

export async function PUT(req: NextRequest): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async (auth) => {
    const input = SetLoanTermsSchema.parse(await req.json());
    await withAdminDb((client) => loanPolicyService.setPlatformTermsDefault(auth.userId, client, input));
    return ok(await withAdminDb((client) => loanPolicyService.getPlatformTerms(client)));
  });
}
