export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withPermission } from '@/lib/auth/middleware';
import { disbursementsService } from '@/lib/services/disbursements.service';
import { ok, handleError } from '@/lib/utils/response';

const ListSchema = z.object({
  page:   z.coerce.number().int().positive().default(1),
  limit:  z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['pending_approval', 'approved', 'rejected', 'dispatched', 'completed', 'failed', 'timed_out', 'reconciled']).optional(),
});

/** GET /api/v1/mpesa/disbursements — the group's B2C payout history + approval queue (treasurer+). */
export async function GET(req: NextRequest): Promise<Response> {
  return withPermission(req, 'payouts.manage', async (auth) => {
    try {
      const params = ListSchema.parse(Object.fromEntries(req.nextUrl.searchParams));
      const ctx    = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
      return ok(await disbursementsService.list(ctx, params));
    } catch (err) {
      return handleError(err);
    }
  });
}
