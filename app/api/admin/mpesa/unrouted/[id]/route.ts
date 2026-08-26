import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok, badRequest } from '@/lib/utils/response';
import { resolveUnroutedPayment } from '@/lib/services/admin.service';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({
  action:   z.enum(['allocate', 'dismiss']),
  groupId:  z.string().uuid().optional(),
  memberId: z.string().uuid().optional(),
  notes:    z.string().optional(),
});

/**
 * Resolve an unrouted M-Pesa payment — allocate to a member's contribution,
 * or dismiss. super_admin only: this creates real money movement (a
 * contribution + journal entry), the same bar as updateGroupStatus above.
 */
export function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withPlatformRole(req, 'super_admin', async (auth) => {
    const { id } = await params;
    const body   = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);

    if (parsed.data.action === 'allocate' && (!parsed.data.groupId || !parsed.data.memberId)) {
      return badRequest('groupId and memberId are required to allocate');
    }

    const result = await resolveUnroutedPayment(id, parsed.data.action, {
      groupId:  parsed.data.groupId,
      memberId: parsed.data.memberId,
      notes:    parsed.data.notes,
      adminId:  auth.userId,
    });
    return ok(result);
  });
}
