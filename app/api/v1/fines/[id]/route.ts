export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { finesService } from '@/lib/services/fines.service';
import { WaiveFineSchema, CancelFineSchema } from '@/lib/validators/fine.schema';
import { ok } from '@/lib/utils/response';

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params): Promise<Response> {
  const { id } = await params;
  return withPermission(req, 'fines.manage', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return ok(await finesService.getById(ctx, id));
  });
}

/**
 * PATCH /api/v1/fines/[id] — action dispatch (loans/[id] pattern):
 *   action: 'waive'               -> WaiveFineSchema   -> finesService.waive
 *   action: 'cancel'              -> CancelFineSchema   -> finesService.cancel
 *   action: 'initiateCollection'  -> (no body)          -> finesService.initiateCollection
 *   action: 'markPaid'            -> (no body)          -> finesService.markPaid
 */
export async function PATCH(req: NextRequest, { params }: Params): Promise<Response> {
  const { id } = await params;
  return withPermission(req, 'fines.manage', async (auth) => {
    const body = await req.json();
    const action = body.action as string;
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };

    if (action === 'waive') {
      const input = WaiveFineSchema.parse(body);
      return ok(await finesService.waive(ctx, id, input));
    }
    if (action === 'cancel') {
      const input = CancelFineSchema.parse(body);
      return ok(await finesService.cancel(ctx, id, input));
    }
    if (action === 'initiateCollection') {
      return ok(await finesService.initiateCollection(ctx, id));
    }
    if (action === 'markPaid') {
      return ok(await finesService.markPaid(ctx, id));
    }

    return ok({ error: 'Unknown action. Use action: waive | cancel | initiateCollection | markPaid' }, 400) as Response;
  });
}
