import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth/middleware';
import { ok, badRequest } from '@/lib/utils/response';
import { updatePlatformUserRole } from '@/lib/services/admin.service';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({
  platformRole: z.enum(['super_admin', 'support', 'ngo_coordinator', 'member']),
});

export function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRole(req, 'super_admin', async () => {
    const { id } = await params;
    const body   = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);

    const result = await updatePlatformUserRole(id, parsed.data.platformRole);
    return ok(result);
  });
}
