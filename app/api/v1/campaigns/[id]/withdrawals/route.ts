export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { campaignWithdrawalsService } from '@/lib/services/campaign-withdrawals.service';
import { assertAuthFresh } from '@/lib/services/membership-guard';
import { requirePermission } from '@/lib/auth/permissions';
import { RequestWithdrawalSchema } from '@/lib/validators/campaign-withdrawals.schema';
import { ok, created, handleError, errorResponse } from '@/lib/utils/response';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/campaigns/:id/withdrawals - list this campaign's withdrawals. */
export async function GET(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withPermission(req, 'payouts.manage', async (auth) => {
    try {
      const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
      return ok(await campaignWithdrawalsService.listForCampaign(ctx, id));
    } catch (err) {
      return handleError(err);
    }
  });
}

/**
 * POST /api/v1/campaigns/:id/withdrawals - request a withdrawal to the
 * campaign's payout phone. Reserves the funds immediately; a second officer
 * must approve before anything reaches Daraja. Same sensitive-op re-check as
 * every other outbound-money route (§2.5): outbound money must not ride a
 * stale token.
 */
export async function POST(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withPermission(req, 'payouts.manage', async (auth) => {
    try {
      const freshPermissions = await assertAuthFresh(auth);
      requirePermission({ role: auth.role, permissions: freshPermissions }, 'payouts.manage');

      const idempotencyKey = req.headers.get('idempotency-key');
      if (!idempotencyKey) {
        return errorResponse(
          'An Idempotency-Key header is required to request a withdrawal',
          'IDEMPOTENCY_KEY_REQUIRED',
          400,
        );
      }

      const input = RequestWithdrawalSchema.parse(await req.json());
      const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
      return created(
        await campaignWithdrawalsService.request(ctx, {
          campaignId: id,
          grossAmount: input.grossAmount,
          idempotencyKey,
        }),
      );
    } catch (err) {
      return handleError(err);
    }
  });
}
