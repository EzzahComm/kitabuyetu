import type { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { requirePermission } from '@/lib/auth/permissions';
import { assertAuthFresh } from '@/lib/services/membership-guard';
import type { TenantContext } from '@/lib/db';

/**
 * Gate for the member-disbursement routes (migration 218): the caller must
 * hold member_payouts.manage per their LIVE role (assertAuthFresh), not just
 * the token's claim — these routes move money. WHICH office may initiate vs
 * approve is decided further in, by member-payouts.service.ts and the
 * migration-218 trigger.
 */
export function withMemberPayoutAccess(
  req: NextRequest,
  handler: (ctx: TenantContext) => Promise<Response>,
): Promise<Response> {
  return withAuth(req, async (auth) => {
    const permissions = await assertAuthFresh(auth);
    requirePermission({ role: auth.role, permissions }, 'member_payouts.manage');
    return handler({ userId: auth.userId, groupId: auth.groupId, role: auth.role });
  });
}
