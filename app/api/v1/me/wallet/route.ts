export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { getMyWalletSummary } from '@/lib/services/member-wallet.service';
import { ok } from '@/lib/utils/response';

/** GET /api/v1/me/wallet — the signed-in member's own savings/shares/loan summary. */
export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const wallet = await getMyWalletSummary(ctx);
    return ok(wallet);
  });
}
