export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOneOf } from '@/lib/auth/middleware';
import { programInvitationsService } from '@/lib/services/program-invitations.service';
import { ok } from '@/lib/utils/response';

/** POST /api/v1/groups/program-invitations/:id/decline */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withOneOf(req, ['chairperson'], async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const { id } = await params;
    return ok(await programInvitationsService.declineInvitation(ctx, id));
  });
}
