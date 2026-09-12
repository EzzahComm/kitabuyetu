export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { organizationService } from '@/lib/services/organization.service';
import { ok } from '@/lib/utils/response';

/**
 * GET /api/admin/organization/members/:id?groupId=… — one member's detail,
 * the final tier of the portfolio drill-down (Org → Group → Member).
 *
 * groupId is required rather than inferred: a member can belong to several
 * groups (§1.2 — and membership_no lives on the membership, not the member), so
 * "this member" is only well-defined together with the membership being viewed.
 * Both ids are verified server-side against the caller's organization; see
 * organizationService.getMemberDetail.
 *
 * Under /api/admin/* because a coordinator holds a backoffice token, which
 * proxy.ts rejects on /api/v1/*.
 */

// Both ids reach `WHERE … = $1` against uuid columns, so a malformed value
// would surface as a Postgres cast error (500) instead of a client error (R14).
const ParamsSchema = z.object({ id: z.string().uuid('Invalid member id') });
const QuerySchema  = z.object({ groupId: z.string().uuid('groupId must be a valid uuid') });

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withOrganizationAccess(req, 'organization.members.view', async (auth) => {
    const { id } = ParamsSchema.parse(await params);
    const { groupId } = QuerySchema.parse({ groupId: req.nextUrl.searchParams.get('groupId') });
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    return ok(await organizationService.getMemberDetail(ctx, groupId, id));
  });
}
