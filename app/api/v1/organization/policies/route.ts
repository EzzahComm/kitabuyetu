export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOrganizationPermission } from '@/lib/auth/middleware';
import { approvalPolicyService } from '@/lib/services/approval-policy.service';
import { SetApprovalPolicySchema } from '@/lib/validators/accounting.schema';
import { ok } from '@/lib/utils/response';

/**
 * GET /api/v1/organization/policies — this organization's effective
 *   ApprovalPolicy thresholds (its own disbursement threshold, plus the
 *   defaults it hands down to linked groups), with resolution provenance.
 * PUT /api/v1/organization/policies — set an organization-level override.
 *
 * organization_coordinator only (asserted in the service; RLS backs it up).
 */

export async function GET(req: NextRequest): Promise<Response> {
  return withOrganizationPermission(req, 'organization.policies.manage', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    return ok(await approvalPolicyService.getOrganizationPolicies(ctx));
  });
}

export async function PUT(req: NextRequest): Promise<Response> {
  return withOrganizationPermission(req, 'organization.policies.manage', async (auth) => {
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const input = SetApprovalPolicySchema.parse(await req.json());
    await approvalPolicyService.setOrganizationOverride(ctx, input.key, input.threshold);
    return ok(await approvalPolicyService.getOrganizationPolicies(ctx));
  });
}
