export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOrganizationPermission } from '@/lib/auth/middleware';
import { organizationService } from '@/lib/services/organization.service';
import { ok } from '@/lib/utils/response';

/** GET /api/v1/organization/members — customer members across every branch linked to this organization. */
export async function GET(req: NextRequest): Promise<Response> {
  return withOrganizationPermission(req, 'organization.members.view', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const p = req.nextUrl.searchParams;
    const params = {
      page:   p.get('page')   ? parseInt(p.get('page')!, 10) : undefined,
      limit:  p.get('limit')  ? parseInt(p.get('limit')!, 10) : undefined,
      search: p.get('search') ?? undefined,
    };
    return ok(await organizationService.listMembers(ctx, params));
  });
}
