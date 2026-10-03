export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { contributionPlanService } from '@/lib/services/contribution-plan.service';
import { SetContributionPlanSchema } from '@/lib/validators/contribution.schema';
import { ok } from '@/lib/utils/response';

/**
 * GET /api/v1/contributions/plan - this group's configured monthly
 *   contribution + welfare amounts, with resolution source. Any authenticated
 *   member can read: the monthly SMS statement and the member-facing balance
 *   view both need this, not just the treasurer.
 * PUT /api/v1/contributions/plan - set a group-level override. Treasurer
 *   only. Feeds notify_contribution_reminders' arrears calculation directly -
 *   unlike /contributions/policy (advisory only), changing this changes what
 *   the next monthly statement SMS says.
 */

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    return ok(await contributionPlanService.getGroupPlan(ctx));
  });
}

export async function PUT(req: NextRequest): Promise<Response> {
  return withPermission(req, 'treasury.manage', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const input = SetContributionPlanSchema.parse(await req.json());
    await contributionPlanService.setGroupPlanOverride(ctx, input);
    return ok(await contributionPlanService.getGroupPlan(ctx));
  });
}
