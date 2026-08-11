export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { groupBankAccountsService } from '@/lib/services/group-bank-accounts.service';
import { CreateGroupBankAccountSchema } from '@/lib/validators/group-bank-accounts.schema';
import { ok, created, handleError } from '@/lib/utils/response';

/** GET /api/v1/treasury/bank-accounts — list all bank accounts for the group. */
export async function GET(req: NextRequest): Promise<Response> {
  return withPermission(req, 'treasury.manage', async (auth) => {
    try {
      const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
      return ok(await groupBankAccountsService.list(ctx));
    } catch (err) {
      return handleError(err);
    }
  });
}

/** POST /api/v1/treasury/bank-accounts — register a bank account (pending_approval). */
export async function POST(req: NextRequest): Promise<Response> {
  return withPermission(req, 'treasury.manage', async (auth) => {
    try {
      const input = CreateGroupBankAccountSchema.parse(await req.json());
      const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
      return created(await groupBankAccountsService.create(ctx, input));
    } catch (err) {
      return handleError(err);
    }
  });
}
