export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { getOrganizationSmsBilling } from '@/lib/services/billing.service';
import { ok, badRequest, confirmedPaymentRequired } from '@/lib/utils/response';

export async function GET(req: NextRequest): Promise<Response> {
  return withOrganizationAccess(req, 'organization.sms.manage', async (ctx) => {
    if (!ctx.organizationId) return badRequest('Organization context is required');
    return ok(await getOrganizationSmsBilling(ctx));
  });
}

export function POST(req: NextRequest): Promise<Response> {
  return withOrganizationAccess(req, 'organization.sms.manage', async () => confirmedPaymentRequired());
}
