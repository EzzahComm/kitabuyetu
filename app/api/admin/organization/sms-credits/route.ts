export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { addOrganizationSmsCredits, getOrganizationSmsBilling } from '@/lib/services/billing.service';
import { TopUpSmsCreditsSchema } from '@/lib/validators/organization.schema';
import { ok, badRequest } from '@/lib/utils/response';

/**
 * GET  /api/v1/organization/sms-credits — this org's SMS balance + recent top-ups
 * POST /api/v1/organization/sms-credits — record a top-up (capital in), self-serve
 *
 * Mirrors app/api/admin/organization/wallet/route.ts exactly, for the
 * separate SMS-credit wallet (organization_billing_accounts.sms_credits)
 * rather than the general capital wallet. Same trust model as that route's
 * deposit(): this records that money already arrived — it does not collect
 * payment itself. organization_coordinator only (super_admin acts on a
 * specific org via /api/admin/organizations/[id]/sms-credits instead, since
 * ctx.organizationId here is never set for a super_admin caller).
 */

export async function GET(req: NextRequest): Promise<Response> {
  return withOrganizationAccess(req, 'organization.sms.manage', async (ctx) => {
    if (!ctx.organizationId) return badRequest('Organization context is required');
    return ok(await getOrganizationSmsBilling(ctx));
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return withOrganizationAccess(req, 'organization.sms.manage', async (ctx) => {
    if (!ctx.organizationId) return badRequest('Organization context is required');

    const parsed = TopUpSmsCreditsSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);

    const result = await addOrganizationSmsCredits(
      ctx.organizationId, parsed.data.amountKes, ctx.userId,
      { reference: parsed.data.reference, notes: parsed.data.notes },
    );
    // null means the insert was swallowed as a duplicate payment (G27).
    // Unreachable from here — this route never passes a paymentId and a NULL
    // one cannot conflict — but reporting a top-up that did not happen is the
    // exact failure the guard exists to prevent, so it is not faked either.
    if (!result) return badRequest('This payment has already been credited');
    return ok(result, 201);
  });
}
