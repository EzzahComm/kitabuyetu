export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { campaignWithdrawalsService } from '@/lib/services/campaign-withdrawals.service';
import { ok } from '@/lib/utils/response';

/** GET /api/admin/campaign-withdrawals — Changi$ha releases awaiting Kitabu Yetu sign-off. Super-admin only. */
export function GET(req: NextRequest): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async () => {
    return ok(await campaignWithdrawalsService.listAwaitingPlatform());
  });
}
