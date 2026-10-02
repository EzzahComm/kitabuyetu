export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { programsService } from '@/lib/services/programs.service';
import { TransitionGroupProgramStatusSchema } from '@/lib/validators/organization.schema';
import { ok } from '@/lib/utils/response';

/** PATCH /api/admin/organization/group-programs/:id/status — draft→published→paused→closed→archived */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withOrganizationAccess(req, 'organization.group_programs.manage', async (ctx) => {
    const { id } = await params;
    const { status } = TransitionGroupProgramStatusSchema.parse(await req.json());
    return ok(await programsService.transitionStatus(ctx, id, status));
  });
}
