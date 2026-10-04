export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { campaignWithdrawalsService } from '@/lib/services/campaign-withdrawals.service';
import { assertAuthFresh } from '@/lib/services/membership-guard';
import { requirePermission } from '@/lib/auth/permissions';
import { WithdrawalActionSchema } from '@/lib/validators/campaign-withdrawals.schema';
import { ok, handleError } from '@/lib/utils/response';

type Ctx = { params: Promise<{ id: string; withdrawalId: string }> };

/** GET /api/v1/campaigns/:id/withdrawals/:withdrawalId */
export async function GET(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { withdrawalId } = await params;
  return withPermission(req, 'campaigns.withdraw', async (auth) => {
    try {
      const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
      return ok(await campaignWithdrawalsService.getById(ctx, withdrawalId));
    } catch (err) {
      return handleError(err);
    }
  });
}

/**
 * POST /api/v1/campaigns/:id/withdrawals/:withdrawalId — approve or reject
 * (campaigns.withdraw). The requester's office counts as their sign-off; the
 * other two offices must each approve, then Kitabu Yetu signs off. Nothing is
 * dispatched from here: only the platform release sends money.
 */
export async function POST(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { withdrawalId } = await params;
  return withPermission(req, 'campaigns.withdraw', async (auth) => {
    try {
      const freshPermissions = await assertAuthFresh(auth);
      requirePermission({ role: auth.role, permissions: freshPermissions }, 'campaigns.withdraw');

      const input = WithdrawalActionSchema.parse(await req.json());
      const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };

      if (input.action === 'approve') return ok(await campaignWithdrawalsService.approve(ctx, withdrawalId));
      return ok(await campaignWithdrawalsService.reject(ctx, withdrawalId, input.reason));
    } catch (err) {
      return handleError(err);
    }
  });
}
