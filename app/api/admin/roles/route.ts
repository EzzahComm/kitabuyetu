import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok, badRequest } from '@/lib/utils/response';
import { listAssignableRoles } from '@/lib/services/member-roles.service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/roles?groupId=<uuid>
 * Roles a member of the given group can be assigned (system defaults + that
 * group's custom roles). Super-admin only.
 */
export function GET(req: NextRequest) {
  return withPlatformRole(req, 'super_admin', async () => {
    const groupId = new URL(req.url).searchParams.get('groupId');
    if (!groupId) return badRequest('groupId is required');
    const roles = await listAssignableRoles(groupId);
    return ok({ items: roles });
  });
}
