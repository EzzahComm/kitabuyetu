import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok, badRequest } from '@/lib/utils/response';
import {
  assignGroupToOrganization, revokeGroupFromOrganization,
} from '@/lib/services/admin-organizations.service';

export const dynamic = 'force-dynamic';

const assignSchema = z.object({
  groupId:     z.string().uuid(),
  accessLevel: z.enum(['read', 'report']).default('read'),
});

/** POST — assign a group to this organization. */
export function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withPlatformRole(req, 'super_admin', async (auth) => {
    const { id }  = await params;
    const body    = await req.json();
    const parsed  = assignSchema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);

    const result = await assignGroupToOrganization(
      id, parsed.data.groupId, auth.userId, parsed.data.accessLevel,
    );
    return ok(result);
  });
}

/** DELETE ?groupId= — revoke a group from this organization. */
export function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withPlatformRole(req, 'super_admin', async (auth) => {
    const { id }  = await params;
    const groupId = new URL(req.url).searchParams.get('groupId');
    if (!groupId) return badRequest('groupId query parameter is required');

    const result = await revokeGroupFromOrganization(id, groupId, auth.userId);
    return ok(result);
  });
}
