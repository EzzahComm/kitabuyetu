export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { listUnrouted } from '@/lib/services/mpesa.service';
import { ok, handleError } from '@/lib/utils/response';

/** GET /api/v1/mpesa/unrouted — unresolved receipts awaiting allocation (treasurer+). */
export async function GET(req: NextRequest): Promise<Response> {
  return withPermission(req, 'mpesa.view', async (auth) => {
    try {
      const items = await listUnrouted({ userId: auth.userId, groupId: auth.groupId, role: auth.role });
      return ok({ items });
    } catch (err) {
      return handleError(err);
    }
  });
}
