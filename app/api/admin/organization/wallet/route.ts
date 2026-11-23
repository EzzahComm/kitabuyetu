export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { organizationFinanceService } from '@/lib/services/organization-finance.service';
import { ok, confirmedPaymentRequired } from '@/lib/utils/response';
import { parsePagination } from '@/lib/utils/pagination';

/**
 * GET  /api/v1/organization/wallet             — wallet position + recent ledger
 *
 * organization_coordinator only (asserted in the service; RLS backs it up).
 */

export async function GET(req: NextRequest): Promise<Response> {
  return withOrganizationAccess(req, 'organization.wallet.view', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const { page, limit } = parsePagination(req.nextUrl.searchParams, { defaultLimit: 25 });
    const [wallet, ledger] = await Promise.all([
      organizationFinanceService.getWallet(ctx),
      organizationFinanceService.listLedger(ctx, { page, limit }),
    ]);
    return ok({ wallet, ledger });
  });
}

export function POST(req: NextRequest): Promise<Response> {
  return withOrganizationAccess(req, 'organization.wallet.view', async () => confirmedPaymentRequired());
}
