export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { membersService } from '@/lib/services/members.service';
import { MemberStatusTransitionSchema } from '@/lib/validators/member.schema';
import { ok, handleError } from '@/lib/utils/response';
import { ROLES } from '@/lib/auth/rbac';
import { ForbiddenError } from '@/lib/utils/errors';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/members/[id]/status
 *
 * Body: { status: MemberStatus, reason?: string }
 *
 * Transitions a member's group_members.status with audit columns populated.
 * Reasons are mandatory for punitive transitions (suspend / reject /
 * blacklist / exit) — enforced in membersService.transitionStatus.
 */
export async function POST(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withAuth(req, async (auth) => {
    if (!ROLES.canManageMembers(auth.role)) throw new ForbiddenError();
    const body  = await req.json();
    const input = MemberStatusTransitionSchema.parse(body);
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const result = await membersService.transitionStatus(ctx, id, input.status, input.reason);
    return ok(result);
  });
}
