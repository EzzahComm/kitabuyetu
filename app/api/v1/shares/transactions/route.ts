export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { sharesService } from '@/lib/services/shares.service';
import { ShareTxnQuerySchema } from '@/lib/validators/shares.schema';
import { confirmedPaymentRequired, ok } from '@/lib/utils/response';

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const params = ShareTxnQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const result = await sharesService.listTransactions(ctx, params);
    return ok(result);
  });
}

export function POST(req: NextRequest): Promise<Response> {
  return withPermission(req, 'shares.manage', async () => confirmedPaymentRequired());
}
