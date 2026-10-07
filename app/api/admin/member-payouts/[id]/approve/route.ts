export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { memberPayoutsService } from '@/lib/services/member-payouts.service';
import { ok } from '@/lib/utils/response';

/** POST — Kitabu Yetu signs off: M-Pesa is dispatched; cash/bank executes and posts both ledgers. Super-admin only. */
export function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async (ctx) => {
    const { id } = await params;
    return ok(await memberPayoutsService.platformApprove(ctx.userId, id));
  });
}
