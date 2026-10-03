export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth, withOneOf } from '@/lib/auth/middleware';
import { organizationGroupLinksService } from '@/lib/services/organization-group-links.service';
import { RequestOrganizationLinkSchema } from '@/lib/validators/organization.schema';
import { ok, created, handleError } from '@/lib/utils/response';

/**
 * GET /api/v1/groups/organization-link - this group's current link (any
 *   status: none/pending/approved/rejected). Any authenticated member can
 *   read, same convention as /api/v1/settings/registration.
 * POST /api/v1/groups/organization-link - request a link to an organization
 *   by name. Chairperson only - same rationale as settings/registration's
 *   PUT: that's who the database lets act on the group's behalf here.
 */

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    try {
      const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
      return ok(await organizationGroupLinksService.getForGroup(ctx));
    } catch (err) {
      return handleError(err);
    }
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return withOneOf(req, ['chairperson'], async (auth) => {
    try {
      const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
      const { organizationName } = RequestOrganizationLinkSchema.parse(await req.json());
      return created(await organizationGroupLinksService.requestLinkFromGroup(ctx, organizationName));
    } catch (err) {
      return handleError(err);
    }
  });
}
