export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withOrganizationPermission } from '@/lib/auth/middleware';
import { organizationService } from '@/lib/services/organization.service';
import { ok, errorResponse } from '@/lib/utils/response';

export async function GET(req: NextRequest): Promise<Response> {
  return withOrganizationPermission(req, 'organization.reports.view', async (auth) => {
    const groupId = req.nextUrl.searchParams.get('groupId');
    if (!groupId) return errorResponse('groupId query param is required', 'VALIDATION_ERROR', 422);
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    return ok(await organizationService.getGroupDetail(ctx, groupId));
  });
}
