export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { campaignsService } from '@/lib/services/campaigns.service';
import { ok } from '@/lib/utils/response';

/** GET /api/admin/campaigns — the pending-review queue. Super-admin only. */
export function GET(req: NextRequest): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async () => {
    const campaigns = await campaignsService.listPendingCampaigns();
    return ok(campaigns);
  });
}
