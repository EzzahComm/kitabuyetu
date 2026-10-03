export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { setOrganizationSmsRate } from '@/lib/services/billing.service';
import { SetSmsRateSchema } from '@/lib/validators/organization.schema';
import { ok, badRequest } from '@/lib/utils/response';

/**
 * POST /api/admin/organizations/[id]/sms-rate — super_admin sets an
 * organization's negotiated per-SMS rate (organization_billing_accounts
 * .sms_rate). The column has existed since migration 051 with a comment
 * saying organizations "negotiate their own per-SMS rate"; nothing has ever
 * written to it before this — it sat at its 0.90 default forever.
 */
export function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withPlatformRole(req, 'super_admin', async (auth) => {
    const { id } = await params;
    const parsed = SetSmsRateSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);

    const result = await setOrganizationSmsRate(id, parsed.data.rate, auth.userId);
    return ok(result);
  });
}
