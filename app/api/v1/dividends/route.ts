export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { dividendsService } from '@/lib/services/dividends.service';
import { CreateDividendDeclarationSchema, DividendQuerySchema } from '@/lib/validators/dividends.schema';
import { created, ok } from '@/lib/utils/response';

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx    = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const params = DividendQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const result = await dividendsService.list(ctx, params);
    return ok(result);
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return withPermission(req, 'dividends.manage', async (auth) => {
    const body  = await req.json();
    const input = CreateDividendDeclarationSchema.parse(body);
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const decl  = await dividendsService.create(ctx, input);
    return created(decl);
  });
}
