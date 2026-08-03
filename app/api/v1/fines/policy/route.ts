export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { finePolicyService } from '@/lib/services/fine-policy.service';
import { SetFineScheduleSchema } from '@/lib/validators/loan.schema';
import { ok } from '@/lib/utils/response';

/**
 * GET /api/v1/fines/policy — this group's effective fine schedule (advisory
 *   offence -> amount tariff) with resolution source.
 * PUT /api/v1/fines/policy — set a group-level override. Chairperson only —
 *   this sets the reference tariff for the whole group.
 */

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    return ok(await finePolicyService.getGroupSchedule(ctx));
  });
}

export async function PUT(req: NextRequest): Promise<Response> {
  return withPermission(req, 'fines.manage', async (auth) => {
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const input = SetFineScheduleSchema.parse(await req.json());
    await finePolicyService.setGroupOverride(ctx, input.schedule);
    return ok(await finePolicyService.getGroupSchedule(ctx));
  });
}
