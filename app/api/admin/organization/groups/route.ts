export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { organizationService } from '@/lib/services/organization.service';
import { ok } from '@/lib/utils/response';
import { parsePagination } from '@/lib/utils/pagination';

export async function GET(req: NextRequest): Promise<Response> {
  return withOrganizationAccess(req, 'organization.groups.view', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const p = req.nextUrl.searchParams;
    const { page, limit } = parsePagination(p, { defaultLimit: 200, maxLimit: 500 });
    const params = { page, limit };
    return ok(await organizationService.listGroupSummaries(ctx, params));
  });
}
