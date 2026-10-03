export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { programInvitationsService } from '@/lib/services/program-invitations.service';
import { ok } from '@/lib/utils/response';

/** POST /api/admin/organization/group-programs/:id/invitations/:invId/cancel - only while still pending */
export async function POST(req: NextRequest, { params }: { params: Promise<{ invId: string }> }): Promise<Response> {
  return withOrganizationAccess(req, 'organization.group_programs.manage', async (ctx) => {
    const { invId } = await params;
    return ok(await programInvitationsService.cancelInvitation(ctx, invId));
  });
}
