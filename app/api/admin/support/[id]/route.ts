import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok, badRequest } from '@/lib/utils/response';
import { updateTicketStatus } from '@/lib/services/admin.service';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({
  status:     z.enum(['open','in_progress','waiting','resolved','closed']),
  resolution: z.string().optional(),
});

export function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withPlatformRole(req, 'super_admin', async (auth) => {
    const { id } = await params;
    const body   = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);

    const result = await updateTicketStatus(id, parsed.data.status, auth.userId, parsed.data.resolution);
    return ok(result);
  });
}
