export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { organizationAccountingService } from '@/lib/services/organization-accounting.service';
import { ok } from '@/lib/utils/response';

/**
 * GET /api/v1/organization/accounting — chart of accounts + trial balance.
 *
 * organization_coordinator only (asserted in the service; RLS backs it up).
 */
export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const [accounts, trialBalance] = await Promise.all([
      organizationAccountingService.listAccounts(ctx),
      organizationAccountingService.getTrialBalance(ctx),
    ]);
    return ok({ accounts, trialBalance });
  });
}
