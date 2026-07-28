import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok, badRequest } from '@/lib/utils/response';
import { acknowledgeAlert, resolveAlert } from '@/lib/services/governance.service';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({ status: z.enum(['acknowledged', 'resolved']) });

export function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withPlatformRole(req, 'super_admin', async (auth) => {
    const { id } = await params;
    const body   = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);

    const result = parsed.data.status === 'acknowledged'
      ? await acknowledgeAlert(id, auth.userId)
      : await resolveAlert(id, auth.userId);
    return ok(result);
  });
}
