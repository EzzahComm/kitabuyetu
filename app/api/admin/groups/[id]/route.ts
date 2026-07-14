import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok, badRequest, notFound } from '@/lib/utils/response';
import { getGroupById, updateGroupStatus } from '@/lib/services/admin.service';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withPlatformRole(req, 'super_admin', async () => {
    const { id } = await params;
    const group = await getGroupById(id);
    if (!group) return notFound('Group not found');
    return ok(group);
  });
}

const actionSchema = z.object({
  action: z.enum(['approve', 'suspend', 'activate', 'deactivate']),
  reason: z.string().optional(),
});

export function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withPlatformRole(req, 'super_admin', async (auth) => {
    const { id } = await params;
    const body   = await req.json();
    const parsed = actionSchema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);

    const result = await updateGroupStatus(id, parsed.data.action, auth.userId, parsed.data.reason);
    return ok(result);
  });
}
