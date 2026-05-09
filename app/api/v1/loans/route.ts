export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withAuth, withRole } from '@/lib/auth/middleware';
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
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return created(await loansService.apply(ctx, input));
  });
}
