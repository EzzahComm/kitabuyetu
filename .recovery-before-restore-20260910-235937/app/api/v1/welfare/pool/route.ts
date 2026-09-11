export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { welfareService, RecordWelfarePoolSchema } from '@/lib/services/welfare.service';
import { ok, created } from '@/lib/utils/response';

export async function GET(req: NextRequest): Promise<Response> {
  return withPermission(req, 'welfare.view', async (auth) => {
    const ctx     = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const { searchParams } = req.nextUrl;
    const page    = Number(searchParams.get('page') ?? 1);
    const limit   = Number(searchParams.get('limit') ?? 20);
    const [summary, contributions] = await Promise.all([
      welfareService.getPoolSummary(ctx),
      welfareService.listPoolContributions(ctx, { page, limit }),
    ]);
    return ok({ summary, contributions });
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return withPermission(req, 'welfare.manage', async (auth) => {
    const body  = await req.json();
    const input = RecordWelfarePoolSchema.parse(body);
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return created(await welfareService.recordPoolContribution(ctx, input));
  });
}
