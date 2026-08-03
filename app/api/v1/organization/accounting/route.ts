export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOrganizationPermission } from '@/lib/auth/middleware';
import { organizationAccountingService } from '@/lib/services/organization-accounting.service';
import { ok } from '@/lib/utils/response';

/**
 * GET /api/v1/organization/accounting — chart of accounts + trial balance.
 *
 * organization_coordinator/super_admin — organizationService.assertOrganizationCoordinator
 * stays as a defense-in-depth backstop inside the service.
 */
export async function GET(req: NextRequest): Promise<Response> {
  return withOrganizationPermission(req, 'organization.accounting.view', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const [accounts, trialBalance] = await Promise.all([
      organizationAccountingService.listAccounts(ctx),
      organizationAccountingService.getTrialBalance(ctx),
    ]);
    return ok({ accounts, trialBalance });
  });
}
