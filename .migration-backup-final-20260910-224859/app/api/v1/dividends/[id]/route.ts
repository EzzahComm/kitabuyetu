export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { dividendsService } from '@/lib/services/dividends.service';
import { UpdateDividendDeclarationSchema } from '@/lib/validators/dividends.schema';
import { ok } from '@/lib/utils/response';

interface RouteParams { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const { id } = await params;
  return withAuth(req, async (auth) => {
    const decl = await dividendsService.get(
      { userId: auth.userId, groupId: auth.groupId, role: auth.role }, id,
    );
    return ok(decl);
  });
}

export async function PATCH(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const { id } = await params;
  return withPermission(req, 'dividends.manage', async (auth) => {
    const body  = await req.json();
    const input = UpdateDividendDeclarationSchema.parse(body);
    const decl  = await dividendsService.update(
      { userId: auth.userId, groupId: auth.groupId, role: auth.role }, id, input,
    );
    return ok(decl);
  });
}
