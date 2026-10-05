export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { programsService } from '@/lib/services/programs.service';
import { UpdateGroupProgramSchema } from '@/lib/validators/organization.schema';
import { ok } from '@/lib/utils/response';

/**
 * GET   /api/admin/organization/group-programs/:id — single program
 * PATCH /api/admin/organization/group-programs/:id — update content fields
 *   (name/description/eligibility/etc). Status transitions are a separate
 *   endpoint — see ./status/route.ts — since they have their own allowed-
 *   transition rules rather than being a free-form field write.
 */

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withOrganizationAccess(req, 'organization.group_programs.view', async (ctx) => {
    const { id } = await params;
    return ok(await programsService.getProgram(ctx, id));
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withOrganizationAccess(req, 'organization.group_programs.manage', async (ctx) => {
    const { id } = await params;
    const input = UpdateGroupProgramSchema.parse(await req.json());
    return ok(await programsService.updateProgram(ctx, id, input));
  });
}
