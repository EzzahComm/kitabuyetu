export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { groupBankAccountsService } from '@/lib/services/group-bank-accounts.service';
import { assertAuthFresh } from '@/lib/services/membership-guard';
import { requirePermission } from '@/lib/auth/permissions';
import { BankAccountActionSchema } from '@/lib/validators/group-bank-accounts.schema';
import { ok, handleError } from '@/lib/utils/response';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/treasury/bank-accounts/:id */
export async function GET(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withPermission(req, 'treasury.manage', async (auth) => {
    try {
      const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
      return ok(await groupBankAccountsService.getById(ctx, id));
    } catch (err) {
      return handleError(err);
    }
  });
}

/**
 * POST /api/v1/treasury/bank-accounts/:id — activate/reject/disable
 * (treasurer+). Activate/reject are maker-checker; disable is single-actor
 * (see group-bank-accounts.service.ts).
 */
export async function POST(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withPermission(req, 'treasury.manage', async (auth) => {
    try {
      // Sensitive op: activating unlocks real money movement to this
      // destination. Re-verify against LIVE roles.permissions.
      const freshPermissions = await assertAuthFresh(auth);
      requirePermission({ role: auth.role, permissions: freshPermissions }, 'treasury.manage');

      const input = BankAccountActionSchema.parse(await req.json());
      const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };

      if (input.action === 'activate') return ok(await groupBankAccountsService.activate(ctx, id));
      if (input.action === 'reject')   return ok(await groupBankAccountsService.reject(ctx, id, input.reason));
      return ok(await groupBankAccountsService.disable(ctx, id, input.reason));
    } catch (err) {
      return handleError(err);
    }
  });
}
