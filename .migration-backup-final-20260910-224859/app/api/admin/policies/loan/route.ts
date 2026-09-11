export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { withAdminDb } from '@/lib/db';
import { loanPolicyService } from '@/lib/services/loan-policy.service';
import { SetTierThresholdsSchema } from '@/lib/validators/credit-scores.schema';
import { ok } from '@/lib/utils/response';

/**
 * GET /api/admin/policies/loan — platform-wide reliability-tier ladder.
 * PUT /api/admin/policies/loan — set the platform-wide default (super_admin only).
 */

export async function GET(req: NextRequest): Promise<Response> {
  return withPlatformRole(req, ['super_admin', 'support'], async () => {
    return ok(await withAdminDb((client) => loanPolicyService.getPlatformPolicy(client)));
  });
}

export async function PUT(req: NextRequest): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async (auth) => {
    const input = SetTierThresholdsSchema.parse(await req.json());
    await withAdminDb((client) => loanPolicyService.setPlatformDefault(auth.userId, client, input.thresholds));
    return ok(await withAdminDb((client) => loanPolicyService.getPlatformPolicy(client)));
  });
}
