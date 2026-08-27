export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { investmentsService, RecordExpenseSchema } from '@/lib/services/investments.service';
import { created } from '@/lib/utils/response';

type Params = { params: Promise<{ id: string }> };

/** Mirrors the sibling returns route, including its permission: recording
 *  what an activity cost is the same class of action as recording what it
 *  paid back, so it sits behind the same `investments.manage` check. */
export async function POST(req: NextRequest, { params }: Params): Promise<Response> {
  const { id } = await params;
  return withPermission(req, 'investments.manage', async (auth) => {
    const body  = await req.json();
    const input = RecordExpenseSchema.parse(body);
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return created(await investmentsService.recordExpense(ctx, id, input));
  });
}
