import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { membersService } from '@/lib/services/members.service';
import { UpdateMemberSchema, UpdateMemberRoleSchema } from '@/lib/validators/member.schema';
import { ok, noContent, handleError } from '@/lib/utils/response';
import { ROLES } from '@/lib/auth/rbac';
import { ForbiddenError } from '@/lib/utils/errors';

type Ctx = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Ctx): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx    = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const member = await membersService.getById(ctx, params.id);
    return ok(member);
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx): Promise<Response> {
  return withAuth(req, async (auth) => {
    const body = await req.json();

    // Members can only update their own profile; admins/secretary can update any
    if (params.id !== auth.userId && !ROLES.canManageMembers(auth.role)) {
      throw new ForbiddenError('You can only edit your own profile');
    }

    const ctx    = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const input  = UpdateMemberSchema.parse(body);
    const member = await membersService.update(ctx, params.id, input);
    return ok(member);
  });
}

export async function PUT(req: NextRequest, { params }: Ctx): Promise<Response> {
  return withAuth(req, async (auth) => {
    if (!ROLES.canAdminGroup(auth.role)) throw new ForbiddenError();
    const body  = await req.json();
    const input = UpdateMemberRoleSchema.parse(body);
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const gm    = await membersService.updateRole(ctx, params.id, input.role);
    return ok(gm);
  });
}

export async function DELETE(req: NextRequest, { params }: Ctx): Promise<Response> {
  return withAuth(req, async (auth) => {
    if (!ROLES.canManageMembers(auth.role)) throw new ForbiddenError();
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    await membersService.deactivate(ctx, params.id);
    return noContent();
  });
}
