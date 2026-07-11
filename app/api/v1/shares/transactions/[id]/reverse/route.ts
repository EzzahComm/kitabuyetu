export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth/middleware';
import { sharesService } from '@/lib/services/shares.service';
import { ReverseTransactionSchema } from '@/lib/validators/shares.schema';
import { ok } from '@/lib/utils/response';

interface RouteParams { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const { id } = await params;
  return withRole(req, 'chairperson', async (auth) => {
    const body   = await req.json();
    const parsed = ReverseTransactionSchema.parse(body);
    const txn    = await sharesService.reverseTransaction(
      { userId: auth.userId, groupId: auth.groupId, role: auth.role }, id, parsed.reason,
    );
    return ok(txn);
  });
}
