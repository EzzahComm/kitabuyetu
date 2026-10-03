export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { organizationGroupLinksService } from '@/lib/services/organization-group-links.service';
import { ok } from '@/lib/utils/response';

/** POST /api/admin/organization-group-links/[id]/approve — pending -> approved, is_active=true. Super-admin only. */
export function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async (ctx) => {
    const { id } = await params;
    return ok(await organizationGroupLinksService.approveLink(ctx.userId, id));
  });
}
