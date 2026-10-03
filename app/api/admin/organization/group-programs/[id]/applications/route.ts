export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { programApplicationsService } from '@/lib/services/program-applications.service';
import { ok } from '@/lib/utils/response';

/** GET /api/admin/organization/group-programs/:id/applications - every application to this program */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withOrganizationAccess(req, 'organization.group_programs.view', async (ctx) => {
    const { id } = await params;
    return ok({ items: await programApplicationsService.listForProgram(ctx, id) });
  });
}
