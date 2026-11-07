import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok, badRequest } from '@/lib/utils/response';
import { resolveUnroutedPayment } from '@/lib/services/admin.service';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({
  action: z.literal('dismiss'),
  groupId: z.string().uuid().optional(),
  notes: z.string().optional(),
}).strict();

/**
 * Dismiss an unrouted M-Pesa payment after review. Allocation and subscription
 * activation from this queue are disabled; corrections use audited reallocation.
 */
export function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withPlatformRole(req, 'super_admin', async (auth) => {
    const { id } = await params;
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);

    const result = await resolveUnroutedPayment(id, parsed.data.action, {
      groupId: parsed.data.groupId,
      notes: parsed.data.notes,
      adminId: auth.userId,
    });
    return ok(result);
  });
}
