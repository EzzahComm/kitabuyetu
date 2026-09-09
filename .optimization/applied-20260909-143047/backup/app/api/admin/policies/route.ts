export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { withAdminDb } from '@/lib/db';
import { approvalPolicyService } from '@/lib/services/approval-policy.service';
import { SetApprovalPolicySchema } from '@/lib/validators/accounting.schema';
import { ok } from '@/lib/utils/response';

/**
 * GET /api/admin/policies — platform-wide ApprovalPolicy defaults.
 * PUT /api/admin/policies — set a platform-wide default (super_admin only).
 *
 * These are the floor every organization/group inherits from unless they
 * override — see ACCOUNTING_ARCHITECTURE_AUDIT.md §29's Configuration
 * Service / Policy Resolution Engine.
 */

export async function GET(req: NextRequest): Promise<Response> {
  return withPlatformRole(req, ['super_admin', 'support'], async () => {
    return ok(await withAdminDb((client) => approvalPolicyService.getPlatformPolicies(client)));
  });
}

export async function PUT(req: NextRequest): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async (auth) => {
    const input = SetApprovalPolicySchema.parse(await req.json());
    await withAdminDb((client) => approvalPolicyService.setPlatformDefault(auth.userId, client, input.key, input.threshold));
    return ok(await withAdminDb((client) => approvalPolicyService.getPlatformPolicies(client)));
  });
}
