export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { organizationGroupLinksService } from '@/lib/services/organization-group-links.service';
import { RequestGroupLinkSchema } from '@/lib/validators/organization.schema';
import { ok, created, handleError } from '@/lib/utils/response';

/**
 * GET /api/v1/organization/group-links - this organization's own links, every status.
 * POST /api/v1/organization/group-links - request a link to a group by its group code.
 */

export async function GET(req: NextRequest): Promise<Response> {
  return withOrganizationAccess(req, 'organization.groups.view', async (ctx) => {
    try {
      return ok(await organizationGroupLinksService.listForOrganization(ctx));
    } catch (err) {
      return handleError(err);
    }
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return withOrganizationAccess(req, 'organization.groups.manage', async (ctx) => {
    try {
      const { groupCode } = RequestGroupLinkSchema.parse(await req.json());
      return created(await organizationGroupLinksService.requestLinkFromOrganization(ctx, groupCode));
    } catch (err) {
      return handleError(err);
    }
  });
}
