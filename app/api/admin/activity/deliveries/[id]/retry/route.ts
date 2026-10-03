export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { retryDelivery } from '@/lib/notifications/activity-query';
import { NotFoundError } from '@/lib/utils/errors';
import { ok } from '@/lib/utils/response';

/** POST /api/admin/activity/deliveries/:id/retry - re-arm a FAILED admin notification. */
export function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async () => {
    const { id } = await params;
    if (!(await retryDelivery(id))) throw new NotFoundError('Failed notification delivery', id);
    return ok({ retried: true });
  });
}
