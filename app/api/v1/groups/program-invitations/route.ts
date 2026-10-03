export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { programInvitationsService } from '@/lib/services/program-invitations.service';
import { ok } from '@/lib/utils/response';

/** GET /api/v1/groups/program-invitations - this group's own invitations, every status */
export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return ok({ items: await programInvitationsService.listForGroup(ctx) });
  });
}
