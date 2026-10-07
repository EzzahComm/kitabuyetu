export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { memberPayoutsService } from '@/lib/services/member-payouts.service';
import { ok } from '@/lib/utils/response';

/** GET /api/admin/member-payouts — treasurer-approved member disbursements awaiting Kitabu Yetu sign-off. Super-admin only. */
export function GET(req: NextRequest): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async () => ok(await memberPayoutsService.listAwaitingPlatform()));
}
