export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { organizationService } from '@/lib/services/organization.service';
import { recordOrgRead, auditRequestMeta } from '@/lib/services/audit.service';
import { ok, errorResponse } from '@/lib/utils/response';

export async function GET(req: NextRequest): Promise<Response> {
  return withOrganizationAccess(req, 'organization.reports.view', async (auth) => {
    const groupId = req.nextUrl.searchParams.get('groupId');
    if (!groupId) return errorResponse('groupId query param is required', 'VALIDATION_ERROR', 422);
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const detail = await organizationService.getGroupDetail(ctx, groupId);

    // R11 — a significant read: one named group's full detail, financials
    // included. Audited AFTER the read succeeds, so an authorization failure
    // is not recorded as an access that happened. Best-effort and deduped;
    // see audit.service.ts for why a failure here must not fail the read.
    await recordOrgRead({
      ctx, action: 'organization.group.detail.view',
      resourceType: 'group', resourceId: groupId, groupId,
      ...auditRequestMeta(req),
    });

    return ok(detail);
  });
}
