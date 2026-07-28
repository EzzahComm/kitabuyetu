import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok, badRequest } from '@/lib/utils/response';
import { getGroupGovernanceSnapshot } from '@/lib/services/governance.service';

export const dynamic = 'force-dynamic';

/** GET ?groupId=... — latest snapshot + health score for one group (group detail health card). */
export function GET(req: NextRequest) {
  return withPlatformRole(req, 'super_admin', async () => {
    const groupId = new URL(req.url).searchParams.get('groupId');
    if (!groupId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(groupId)) {
      return badRequest('groupId is required');
    }
    const data = await getGroupGovernanceSnapshot(groupId);
    return ok(data);
  });
}
