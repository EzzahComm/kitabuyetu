export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/middleware';
import { organizationFinanceService } from '@/lib/services/organization-finance.service';
import { ok } from '@/lib/utils/response';

/**
 * GET  /api/v1/organization/wallet             — wallet position + recent ledger
 * POST /api/v1/organization/wallet             — record a deposit (capital in)
 *
 * organization_coordinator only (asserted in the service; RLS backs it up).
 */

const DepositSchema = z.object({
  amount:    z.number().positive('Amount must be positive').max(1_000_000_000),
  source:    z.string().max(160).optional(),
  reference: z.string().max(64).optional(),
  notes:     z.string().max(500).optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const page  = parseInt(req.nextUrl.searchParams.get('page')  ?? '1', 10);
    const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '25', 10);
    const [wallet, ledger] = await Promise.all([
      organizationFinanceService.getWallet(ctx),
      organizationFinanceService.listLedger(ctx, { page, limit }),
    ]);
    return ok({ wallet, ledger });
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const input = DepositSchema.parse(await req.json());
    const result = await organizationFinanceService.deposit(ctx, input);
    return ok(result, 201);
  });
}
