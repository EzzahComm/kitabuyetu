export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { investmentsService, RecordReturnSchema } from '@/lib/services/investments.service';
import { created } from '@/lib/utils/response';

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params): Promise<Response> {
  const { id } = await params;
  return withPermission(req, 'investments.manage', async (auth) => {
    const body  = await req.json();
    const input = RecordReturnSchema.parse(body);
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return created(await investmentsService.recordReturn(ctx, id, input));
  });
}
