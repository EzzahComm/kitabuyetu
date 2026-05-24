export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { membersService } from '@/lib/services/members.service';
import { UpdateNextOfKinSchema } from '@/lib/validators/member.schema';
import { ok, noContent } from '@/lib/utils/response';
import { ROLES } from '@/lib/auth/rbac';
import { ForbiddenError } from '@/lib/utils/errors';

type Ctx = { params: Promise<{ id: string; kinId: string }> };

// PATCH /api/v1/members/[id]/next-of-kin/[kinId]
export async function PATCH(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id, kinId } = await params;
  return withAuth(req, async (auth) => {
    if (!ROLES.canManageMembers(auth.role)) throw new ForbiddenError();
    const body  = await req.json();
    const input = UpdateNextOfKinSchema.parse(body);
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const row   = await membersService.updateNextOfKin(ctx, id, kinId, input);
    return ok(row);
  });
}

// DELETE /api/v1/members/[id]/next-of-kin/[kinId]
export async function DELETE(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id, kinId } = await params;
  return withAuth(req, async (auth) => {
    if (!ROLES.canManageMembers(auth.role)) throw new ForbiddenError();
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    await membersService.deleteNextOfKin(ctx, id, kinId);
    return noContent();
  });
}
