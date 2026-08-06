export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { loanPolicyService } from '@/lib/services/loan-policy.service';
import { SetTierThresholdsSchema } from '@/lib/validators/credit-scores.schema';
import { ok } from '@/lib/utils/response';

/**
 * GET /api/v1/credit-scores/policy — this group's effective reliability-tier
 *   ladder (min score + loan multiplier per tier), with resolution source.
 * PUT /api/v1/credit-scores/policy — set a group-level override. Gated at
 *   chairperson (same bar as recomputeAll — this changes scoring for every
 *   member, not just one).
 */

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    return ok(await loanPolicyService.getGroupPolicy(ctx));
  });
}

export async function PUT(req: NextRequest): Promise<Response> {
  return withPermission(req, 'credit_scores.policy.manage', async (auth) => {
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const input = SetTierThresholdsSchema.parse(await req.json());
    await loanPolicyService.setGroupOverride(ctx, input.thresholds);
    return ok(await loanPolicyService.getGroupPolicy(ctx));
  });
}
