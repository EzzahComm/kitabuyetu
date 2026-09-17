export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { budgetService } from '@/lib/services/budget.service';
import { CreateBudgetSchema, BudgetQuerySchema } from '@/lib/validators/budget.schema';
import { ok, created } from '@/lib/utils/response';

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const params = BudgetQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const ctx    = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return ok(await budgetService.list(ctx, params));
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return withPermission(req, 'accounting.manage', async (auth) => {
    const input = CreateBudgetSchema.parse(await req.json());
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return created(await budgetService.create(ctx, input));
  });
}
