export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withAuth, withRole } from '@/lib/auth/middleware';
import { membersService } from '@/lib/services/members.service';
import { MemberQuerySchema, CreateMemberSchema } from '@/lib/validators/member.schema';
import { ok, created, handleError } from '@/lib/utils/response';

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const { searchParams } = req.nextUrl;
    const params = MemberQuerySchema.parse(Object.fromEntries(searchParams));
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const result = await membersService.list(ctx, params);
    return ok(result);
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return withRole(req, 'secretary', async (auth) => {
    const body  = await req.json();
    const input = CreateMemberSchema.parse(body);
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const member = await membersService.create(ctx, input);
    return created(member);
  });
}
