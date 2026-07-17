export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth, withRole } from '@/lib/auth/middleware';
import { savingsPolicyService } from '@/lib/services/savings-policy.service';
import { SetSavingsLimitsSchema } from '@/lib/validators/contribution.schema';
import { ok } from '@/lib/utils/response';

/**
 * GET /api/v1/contributions/policy — this group's effective savings limits
 *   (advisory min/max contribution amount, grace period) with resolution
 *   source. Any authenticated member can read: the contribution form uses
 *   these only to pre-fill/annotate, never to block a submission.
 * PUT /api/v1/contributions/policy — set a group-level override. Treasurer
 *   only — this changes the group's advisory savings guidance.
 */

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    return ok(await savingsPolicyService.getGroupLimits(ctx));
  });
}

export async function PUT(req: NextRequest): Promise<Response> {
  return withRole(req, 'treasurer', async (auth) => {
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const input = SetSavingsLimitsSchema.parse(await req.json());
    await savingsPolicyService.setGroupLimitsOverride(ctx, input);
    return ok(await savingsPolicyService.getGroupLimits(ctx));
  });
}
