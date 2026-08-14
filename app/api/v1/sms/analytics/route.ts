export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { getUsageAnalytics } from '@/lib/services/sms-analytics.service';
import { ok } from '@/lib/utils/response';

/**
 * A group's own SMS usage (spec §8).
 *
 * TENANT-FACING, so it carries no cost or margin: §15 forbids exposing what
 * the provider charges us. `costThisMonth` is what THIS GROUP pays at its own
 * rate, which is theirs to see. The internal view lives at
 * /api/admin/sms-margin behind a platform role.
 */
export async function GET(req: NextRequest): Promise<Response> {
  return withPermission(req, 'messaging.view', async (auth) => {
    return ok(await getUsageAnalytics(auth.groupId));
  });
}
