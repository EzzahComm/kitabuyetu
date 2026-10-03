export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { programApplicationsService } from '@/lib/services/program-applications.service';
import { DeclineProgramApplicationSchema } from '@/lib/validators/organization.schema';
import { ok } from '@/lib/utils/response';

/** POST /api/admin/organization/group-programs/:id/applications/:appId/decline - requires a reason */
export async function POST(req: NextRequest, { params }: { params: Promise<{ appId: string }> }): Promise<Response> {
  return withOrganizationAccess(req, 'organization.group_programs.manage', async (ctx) => {
    const { appId } = await params;
    const { reviewNotes } = DeclineProgramApplicationSchema.parse(await req.json());
    return ok(await programApplicationsService.declineApplication(ctx, appId, reviewNotes));
  });
}
