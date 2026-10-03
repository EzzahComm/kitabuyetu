export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { organizationGroupLinksService } from '@/lib/services/organization-group-links.service';
import { ok } from '@/lib/utils/response';

/** GET /api/admin/organization-group-links - every link request awaiting platform review. Super-admin only. */
export function GET(req: NextRequest): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async () => {
    return ok(await organizationGroupLinksService.listPendingRequests());
  });
}
