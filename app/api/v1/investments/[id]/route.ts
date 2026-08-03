export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { investmentsService, UpdateInvestmentSchema } from '@/lib/services/investments.service';
import { ok } from '@/lib/utils/response';

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params): Promise<Response> {
  const { id } = await params;
  return withPermission(req, 'investments.view', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return ok(await investmentsService.getById(ctx, id));
  });
}

export async function PATCH(req: NextRequest, { params }: Params): Promise<Response> {
  const { id } = await params;
  return withPermission(req, 'investments.manage', async (auth) => {
    const body  = await req.json();
    const input = UpdateInvestmentSchema.parse(body);
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return ok(await investmentsService.update(ctx, id, input));
  });
}
