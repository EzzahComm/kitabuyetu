export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { organizationService } from '@/lib/services/organization.service';
import { ok } from '@/lib/utils/response';
import { parsePagination } from '@/lib/utils/pagination';

/** GET /api/v1/organization/audit-logs — audit trail scoped to this organization's own branches. */
export async function GET(req: NextRequest): Promise<Response> {
  return withOrganizationAccess(req, 'organization.audit_logs.view', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const p = req.nextUrl.searchParams;
    const { page, limit } = parsePagination(p, { defaultLimit: 25, maxLimit: 100 });
    const params = {
      page,
      limit,
      search: p.get('search') ?? undefined,
    };
    return ok(await organizationService.listAuditLogs(ctx, params));
  });
}
