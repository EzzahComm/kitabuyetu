export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { requirePermission } from '@/lib/auth/permissions';
import { loansService } from '@/lib/services/loans.service';
import { LoanQuerySchema, ApplyLoanSchema } from '@/lib/validators/loan.schema';
import { ok, created } from '@/lib/utils/response';

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const params = LoanQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const ctx    = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return ok(await loansService.list(ctx, params));
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const input = ApplyLoanSchema.parse(await req.json());
    // Applying for yourself needs no extra permission; applying on another
    // member's behalf is an officer action.
    if (input.memberId && input.memberId !== auth.userId) {
      requirePermission(auth, 'loans.approve');
    }
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return created(await loansService.apply(ctx, input));
  });
}
