export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withRole } from '@/lib/auth/middleware';
import { resolveUnrouted } from '@/lib/services/mpesa.service';
import { assertAuthFresh } from '@/lib/services/membership-guard';
import { ok, handleError } from '@/lib/utils/response';

const Schema = z.object({
  action:   z.enum(['allocate', 'dismiss']),
  memberId: z.string().uuid().optional(),
  notes:    z.string().max(500).optional(),
}).superRefine((v, ctx) => {
  if (v.action === 'allocate' && !v.memberId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['memberId'], message: 'memberId is required to allocate' });
  }
});

/** POST /api/v1/mpesa/unrouted/[id]/resolve — allocate to a member or dismiss (treasurer+). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withRole(req, 'treasurer', async (auth) => {
    try {
      // Sensitive op (§2.5): allocation of unrouted money re-checks epochs.
      await assertAuthFresh(auth);

      const { id } = await params;
      const input  = Schema.parse(await req.json());
      await resolveUnrouted(
        { userId: auth.userId, groupId: auth.groupId, role: auth.role },
        id,
        input.action,
        { memberId: input.memberId, notes: input.notes },
      );
      return ok({ resolved: true });
    } catch (err) {
      return handleError(err);
    }
  });
}
