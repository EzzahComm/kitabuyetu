export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { budgetService } from '@/lib/services/budget.service';
import { UpdateBudgetSchema } from '@/lib/validators/budget.schema';
import { ok, noContent } from '@/lib/utils/response';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withAuth(req, async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return ok(await budgetService.getById(ctx, id));
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withPermission(req, 'accounting.manage', async (auth) => {
    const input = UpdateBudgetSchema.parse(await req.json());
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return ok(await budgetService.update(ctx, id, input));
  });
}

export async function DELETE(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withPermission(req, 'accounting.manage', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    await budgetService.delete(ctx, id);
    return noContent();
  });
}
