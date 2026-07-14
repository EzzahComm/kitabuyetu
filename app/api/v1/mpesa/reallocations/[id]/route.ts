export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withRole } from '@/lib/auth/middleware';
import { reallocationsService } from '@/lib/services/reallocations.service';
import { assertAuthFresh } from '@/lib/services/membership-guard';
import { ok, handleError } from '@/lib/utils/response';

type Ctx = { params: Promise<{ id: string }> };

const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('reject'), reason: z.string().min(5).max(500) }),
]);

/**
 * POST /api/v1/mpesa/reallocations/:id — approve or reject a pending
 * correction (treasurer+). Maker-checker: the service rejects approval by
 * the initiator (ADR-20).
 */
export async function POST(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withRole(req, 'treasurer', async (auth) => {
    try {
      // Sensitive op (§2.5): approving a correction executes money movement.
      await assertAuthFresh(auth);

      const input = ActionSchema.parse(await req.json());
      const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };

      if (input.action === 'approve') {
        return ok(await reallocationsService.approve(ctx, id));
      }
      return ok(await reallocationsService.reject(ctx, id, input.reason));
    } catch (err) {
      return handleError(err);
    }
  });
}
