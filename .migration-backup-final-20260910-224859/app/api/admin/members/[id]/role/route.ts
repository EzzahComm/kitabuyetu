import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok, badRequest, handleError } from '@/lib/utils/response';
import { assignGroupMemberRole } from '@/lib/services/member-roles.service';

export const dynamic = 'force-dynamic';

const schema = z.object({
  groupId: z.string().uuid('groupId must be a valid UUID'),
  roleId:  z.string().uuid('roleId must be a valid UUID'),
});

/**
 * POST /api/admin/members/[id]/role
 * Body: { groupId, roleId }
 *
 * Assign (or change) the member's role within a specific group. Super-admin
 * only — authorization is enforced server-side; the client cannot elevate its
 * own scope. The actor, previous/new role, group, org, IP and user-agent are
 * recorded in audit_logs.
 */
export function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withPlatformRole(req, 'super_admin', async (ctx) => {
    try {
      const { id: memberId } = await params;
      const parsed = schema.safeParse(await req.json());
      if (!parsed.success) return badRequest(parsed.error.errors[0].message);

      const ipAddress =
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
        req.headers.get('x-real-ip') ??
        null;
      const userAgent = req.headers.get('user-agent') ?? null;

      const result = await assignGroupMemberRole({
        actorId:  ctx.userId,
        memberId,
        groupId:  parsed.data.groupId,
        roleId:   parsed.data.roleId,
        ipAddress,
        userAgent,
      });
      return ok(result);
    } catch (err) {
      return handleError(err);
    }
  });
}
