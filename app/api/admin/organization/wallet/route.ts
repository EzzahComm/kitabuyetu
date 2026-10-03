export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { organizationFinanceService } from '@/lib/services/organization-finance.service';
import { DepositSchema } from '@/lib/validators/organization.schema';
import { ok } from '@/lib/utils/response';
import { parsePagination } from '@/lib/utils/pagination';

/**
 * GET  /api/v1/organization/wallet             — wallet position + recent ledger
 * POST /api/v1/organization/wallet             — record a deposit (capital in)
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

export async function POST(req: NextRequest): Promise<Response> {
  return withOrganizationAccess(req, 'organization.wallet.view', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const input = DepositSchema.parse(await req.json());
    const result = await organizationFinanceService.deposit(ctx, input);
    return ok(result, 201);
  });
}
