import { NextRequest } from 'next/server';
import { z } from 'zod/v3';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { getEnterpriseBilling, promptEnterprisePayment } from '@/lib/services/enterprise-billing.service';
import { normalizePhone } from '@/lib/utils/phone';
import { ValidationError } from '@/lib/utils/errors';
import { ok } from '@/lib/utils/response';

export function GET(req: NextRequest) {
  return withOrganizationAccess(req, 'organization.plan.view', async (ctx) => {
    if (!ctx.organizationId) throw new ValidationError('Select an organization.');
    return ok(await getEnterpriseBilling(ctx.organizationId));
  });
}
export function POST(req: NextRequest) {
  return withOrganizationAccess(req, 'organization.plan.view', async (ctx) => {
    if (!ctx.organizationId) throw new ValidationError('Select an organization.');
    const { phone } = z.object({ phone: z.string().max(20) }).parse(await req.json());
    await promptEnterprisePayment(ctx.organizationId, normalizePhone(phone));
    return ok({ requested: true });
  });
}
