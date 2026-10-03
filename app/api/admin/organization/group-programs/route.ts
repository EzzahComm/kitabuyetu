export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { programsService } from '@/lib/services/programs.service';
import { CreateGroupProgramSchema } from '@/lib/validators/organization.schema';
import { ok, created } from '@/lib/utils/response';

/**
 * GET  /api/admin/organization/group-programs — list this organization's
 *   programs (recruitment/membership — unrelated to the budget-centric
 *   /api/admin/organization/programs, which is funding_programs).
 * POST /api/admin/organization/group-programs — create a program (draft)
 */

export async function GET(req: NextRequest): Promise<Response> {
  return withOrganizationAccess(req, 'organization.group_programs.view', async (ctx) => {
    return ok({ items: await programsService.listPrograms(ctx) });
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return withOrganizationAccess(req, 'organization.group_programs.manage', async (ctx) => {
    const input = CreateGroupProgramSchema.parse(await req.json());
    return created(await programsService.createProgram(ctx, input));
  });
}
