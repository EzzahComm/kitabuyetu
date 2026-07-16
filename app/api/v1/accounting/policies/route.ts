export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth/middleware';
import { approvalPolicyService } from '@/lib/services/approval-policy.service';
import { SetApprovalPolicySchema } from '@/lib/validators/accounting.schema';
import { ok } from '@/lib/utils/response';

/**
 * GET /api/v1/accounting/policies — this group's effective ApprovalPolicy
 *   thresholds (journal + disbursement), each with its resolution source
 *   (group / organization / platform) so the settings UI can show where a
 *   value is inherited from.
 * PUT /api/v1/accounting/policies — set a group-level override.
 *
 * treasurer+ only, same gate as fiscal periods / journals / accounts.
 */

export async function GET(req: NextRequest): Promise<Response> {
  return withRole(req, 'treasurer', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return ok(await approvalPolicyService.getGroupPolicies(ctx));
  });
}

export async function PUT(req: NextRequest): Promise<Response> {
  return withRole(req, 'treasurer', async (auth) => {
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const input = SetApprovalPolicySchema.parse(await req.json());
    await approvalPolicyService.setGroupOverride(ctx, input.key, input.threshold);
    return ok(await approvalPolicyService.getGroupPolicies(ctx));
  });
}
