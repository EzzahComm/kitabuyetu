import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok } from '@/lib/utils/response';
import { resolveUnroutedPayment } from '@/lib/services/admin.service';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({
  action: z.literal('dismiss'),
  groupId: z.string().uuid().optional(),
  notes: z.string().optional(),
}).strict();

/**
 * Resolve an unrouted M-Pesa payment — allocate to a member's contribution,
 * activate a subscription, or dismiss. super_admin only: every non-dismiss
 * action creates real money movement, the same bar as updateGroupStatus above.
 */
export function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withPlatformRole(req, 'super_admin', async (auth) => {
    const { id } = await params;
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);

    const result = await resolveUnroutedPayment(id, parsed.data.action, {
      groupId: parsed.data.groupId,
      memberId: parsed.data.memberId,
      notes: parsed.data.notes,
      planType: parsed.data.planType,
      product: parsed.data.product,
      billingCycle: parsed.data.billingCycle,
      adminId: auth.userId,
    });
    return ok(result);
  });
}
