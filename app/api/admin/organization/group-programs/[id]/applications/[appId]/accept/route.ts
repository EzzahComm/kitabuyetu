export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { programApplicationsService } from '@/lib/services/program-applications.service';
import { AcceptProgramApplicationSchema } from '@/lib/validators/organization.schema';
import { ok } from '@/lib/utils/response';

/** POST /api/admin/organization/group-programs/:id/applications/:appId/accept - activates program membership */
export async function POST(req: NextRequest, { params }: { params: Promise<{ appId: string }> }): Promise<Response> {
  return withOrganizationAccess(req, 'organization.group_programs.manage', async (ctx) => {
    const { appId } = await params;
    const { reviewNotes } = AcceptProgramApplicationSchema.parse(await req.json().catch(() => ({})));
    return ok(await programApplicationsService.acceptApplication(ctx, appId, reviewNotes));
  });
}
