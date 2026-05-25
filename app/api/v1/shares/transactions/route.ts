export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth, withRole } from '@/lib/auth/middleware';
import { sharesService } from '@/lib/services/shares.service';
import { CreateShareTransactionSchema, ShareTxnQuerySchema } from '@/lib/validators/shares.schema';
import { created, ok } from '@/lib/utils/response';

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx    = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const params = ShareTxnQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const result = await sharesService.listTransactions(ctx, params);
    return ok(result);
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return withRole(req, 'treasurer', async (auth) => {
    const body  = await req.json();
    const input = CreateShareTransactionSchema.parse(body);
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const rows  = await sharesService.createTransaction(ctx, input);
    return created({ items: rows });
  });
}
