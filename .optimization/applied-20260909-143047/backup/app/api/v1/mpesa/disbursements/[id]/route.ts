export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withPermission } from '@/lib/auth/middleware';
import { disbursementsService } from '@/lib/services/disbursements.service';
import { assertAuthFresh } from '@/lib/services/membership-guard';
import { requirePermission } from '@/lib/auth/permissions';
import { ok, handleError } from '@/lib/utils/response';

type Ctx = { params: Promise<{ id: string }> };

const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('reject'), reason: z.string().min(5).max(500) }),
]);

/**
 * POST /api/v1/mpesa/disbursements/:id — approve or reject a pending B2C
 * disbursement (treasurer+). Maker-checker: the service rejects approval by
 * the initiator (B2C audit C3).
 */
export async function POST(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withPermission(req, 'payouts.manage', async (auth) => {
    try {
      // Sensitive op (§2.5): approving a disbursement dispatches real money.
      // Re-verify against LIVE roles.permissions, not just the token's claim.
      const freshPermissions = await assertAuthFresh(auth);
      requirePermission({ role: auth.role, permissions: freshPermissions }, 'payouts.manage');

      const input = ActionSchema.parse(await req.json());
      const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };

      if (input.action === 'approve') {
        return ok(await disbursementsService.approve(ctx, id));
      }
      return ok(await disbursementsService.reject(ctx, id, input.reason));
    } catch (err) {
      return handleError(err);
    }
  });
}
