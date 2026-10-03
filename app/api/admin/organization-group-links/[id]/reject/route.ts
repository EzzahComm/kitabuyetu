export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { organizationGroupLinksService } from '@/lib/services/organization-group-links.service';
import { RejectOrgGroupLinkSchema } from '@/lib/validators/organization.schema';
import { ok } from '@/lib/utils/response';

/** POST /api/admin/organization-group-links/[id]/reject — pending -> rejected, reason required. Super-admin only. */
export function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async (ctx) => {
    const { id } = await params;
    const { reason } = RejectOrgGroupLinkSchema.parse(await req.json());
    return ok(await organizationGroupLinksService.rejectLink(ctx.userId, id, reason));
  });
}
