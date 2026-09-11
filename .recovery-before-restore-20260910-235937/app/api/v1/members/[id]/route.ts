import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { membersService } from '@/lib/services/members.service';
import { UpdateMemberSchema, UpdateMemberRoleSchema } from '@/lib/validators/member.schema';
import { ok, noContent } from '@/lib/utils/response';
import { hasPermission, requirePermission } from '@/lib/auth/permissions';
import { ForbiddenError } from '@/lib/utils/errors';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withAuth(req, async (auth) => {
    const ctx    = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const member = await membersService.getById(ctx, id);
    return ok(member);
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withAuth(req, async (auth) => {
    const body = await req.json();

    // Members can only update their own profile; admins/secretary can update any
    if (id !== auth.userId && !hasPermission(auth, 'members.manage')) {
      throw new ForbiddenError('You can only edit your own profile');
    }

    const ctx    = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const input  = UpdateMemberSchema.parse(body);
    const member = await membersService.update(ctx, id, input);
    return ok(member);
  });
}

export async function PUT(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withAuth(req, async (auth) => {
    // Changing a member's group role is the same capability as assigning
    // roles elsewhere in the app (roles.manage, chairperson+) — not
    // members.manage, which secretary already has and shouldn't extend to
    // role changes.
    requirePermission(auth, 'roles.manage');
    const body  = await req.json();
    const input = UpdateMemberRoleSchema.parse(body);
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const gm    = await membersService.updateRole(ctx, id, input.role);
    return ok(gm);
  });
}

export async function DELETE(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withAuth(req, async (auth) => {
    requirePermission(auth, 'members.manage');
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    await membersService.deactivate(ctx, id);
    return noContent();
  });
}
