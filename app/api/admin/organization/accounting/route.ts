export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { organizationAccountingService } from '@/lib/services/organization-accounting.service';
import { ok } from '@/lib/utils/response';

/**
 * GET /api/v1/organization/accounting — trial balance.
 *
 * organization_coordinator/super_admin — organizationService.assertOrganizationCoordinator
 * stays as a defense-in-depth backstop inside the service.
 *
 * Used to also fetch listAccounts() in parallel and return it as `accounts`
 * — a second full pooled transaction (its own withDb) for a field the
 * endpoints.ts type never declared and neither real caller (funding/page.tsx,
 * reports/page.tsx) ever read (docs/audits/optimization-2026-09). Dropped;
 * listAccounts still exists on the service for a future real caller.
 */
export async function GET(req: NextRequest): Promise<Response> {
  return withOrganizationAccess(req, 'organization.accounting.view', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const trialBalance = await organizationAccountingService.getTrialBalance(ctx);
    return ok({ trialBalance });
  });
}
