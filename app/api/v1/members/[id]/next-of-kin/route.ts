export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { membersService } from '@/lib/services/members.service';
import { CreateNextOfKinSchema } from '@/lib/validators/member.schema';
import { ok, created } from '@/lib/utils/response';
import { ROLES } from '@/lib/auth/rbac';
import { ForbiddenError } from '@/lib/utils/errors';

type Ctx = { params: Promise<{ id: string }> };

// GET /api/v1/members/[id]/next-of-kin — list a member's emergency contacts.
// Restricted to group admins + secretaries (same as POST/PATCH/DELETE below):
// these rows carry unmasked national_id/phone/email/address, and unlike a
// member's own record (masked via applyMemberMask for non-privileged roles)
// there's no masking layer here, so open read access would let any group
// member see PII more freely for a colleague's emergency contact than for
// the colleague themselves.
export async function GET(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withAuth(req, async (auth) => {
    if (!ROLES.canManageMembers(auth.role)) throw new ForbiddenError();
    const ctx  = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const rows = await membersService.listNextOfKin(ctx, id);
    return ok(rows);
  });
}

// POST /api/v1/members/[id]/next-of-kin — add a new emergency contact.
// Restricted to group admins + secretaries (RLS also enforces this).
export async function POST(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withAuth(req, async (auth) => {
    if (!ROLES.canManageMembers(auth.role)) throw new ForbiddenError();
    const body  = await req.json();
    const input = CreateNextOfKinSchema.parse(body);
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const row   = await membersService.createNextOfKin(ctx, id, input);
    return created(row);
  });
}
