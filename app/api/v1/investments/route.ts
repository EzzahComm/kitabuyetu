export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { investmentsService, InvestmentQuerySchema, CreateInvestmentSchema } from '@/lib/services/investments.service';
import { ok, created } from '@/lib/utils/response';

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const params = InvestmentQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const ctx    = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const summary = req.nextUrl.searchParams.get('summary') === '1';
    if (summary) return ok(await investmentsService.getSummary(ctx));
    return ok(await investmentsService.list(ctx, params));
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const body  = await req.json();
    const input = CreateInvestmentSchema.parse(body);
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return created(await investmentsService.create(ctx, input));
  });
}
