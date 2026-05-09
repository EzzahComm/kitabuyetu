export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withAuth, withRole } from '@/lib/auth/middleware';
import { accountingService } from '@/lib/services/accounting.service';
import { CreateAccountSchema } from '@/lib/validators/accounting.schema';
import { ok, created } from '@/lib/utils/response';

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return ok(await accountingService.listAccounts(ctx));
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return withRole(req, 'treasurer', async (auth) => {
    const input = CreateAccountSchema.parse(await req.json());
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return created(await accountingService.createAccount(ctx, input));
  });
}
