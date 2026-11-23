export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { organizationFinanceService } from '@/lib/services/organization-finance.service';
import { ok, confirmedPaymentRequired } from '@/lib/utils/response';

export async function GET(req: NextRequest): Promise<Response> {
  return withOrganizationAccess(req, 'organization.disbursements.manage', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const page = parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10);
    const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '25', 10);
    return ok(await organizationFinanceService.listDisbursements(ctx, { page, limit }));
  });
}

export function POST(req: NextRequest): Promise<Response> {
  return withOrganizationAccess(req, 'organization.disbursements.manage', async () => confirmedPaymentRequired());
}
