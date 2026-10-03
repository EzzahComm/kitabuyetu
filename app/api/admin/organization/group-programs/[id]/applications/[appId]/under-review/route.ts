export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { programApplicationsService } from '@/lib/services/program-applications.service';
import { ok } from '@/lib/utils/response';

/** POST /api/admin/organization/group-programs/:id/applications/:appId/under-review - marks review as started */
export async function POST(req: NextRequest, { params }: { params: Promise<{ appId: string }> }): Promise<Response> {
  return withOrganizationAccess(req, 'organization.group_programs.manage', async (ctx) => {
    const { appId } = await params;
    return ok(await programApplicationsService.markUnderReview(ctx, appId));
  });
}
