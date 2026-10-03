export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { programInvitationsService } from '@/lib/services/program-invitations.service';
import { InviteGroupToProgramSchema } from '@/lib/validators/organization.schema';
import { ok, created } from '@/lib/utils/response';

/**
 * GET  /api/admin/organization/group-programs/:id/invitations - every invitation for this program
 * POST /api/admin/organization/group-programs/:id/invitations - invite a group by its group code
 */

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withOrganizationAccess(req, 'organization.group_programs.view', async (ctx) => {
    const { id } = await params;
    return ok({ items: await programInvitationsService.listForProgram(ctx, id) });
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withOrganizationAccess(req, 'organization.group_programs.manage', async (ctx) => {
    const { id } = await params;
    const { groupCode, message } = InviteGroupToProgramSchema.parse(await req.json());
    return created(await programInvitationsService.inviteGroup(ctx, id, groupCode, message));
  });
}
