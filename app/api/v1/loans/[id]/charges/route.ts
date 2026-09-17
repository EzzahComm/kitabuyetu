import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { loanChargesService } from '@/lib/services/loan-charges.service';
import { ok } from '@/lib/utils/response';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/loans/[id]/charges — every charge ever applied to this loan (processing fee, late fees, …), most recent first. */
export async function GET(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withAuth(req, async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return ok(await loanChargesService.listChargesForLoan(ctx, id));
  });
}
