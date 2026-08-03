export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withOrganizationPermission } from '@/lib/auth/middleware';
import { organizationService } from '@/lib/services/organization.service';
import { ok } from '@/lib/utils/response';

export async function GET(req: NextRequest): Promise<Response> {
  return withOrganizationPermission(req, 'organization.groups.view', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const p = req.nextUrl.searchParams;
    const params = {
      page:  p.get('page')  ? parseInt(p.get('page')!, 10)  : undefined,
      limit: p.get('limit') ? parseInt(p.get('limit')!, 10) : undefined,
    };
    return ok(await organizationService.listGroupSummaries(ctx, params));
  });
}
