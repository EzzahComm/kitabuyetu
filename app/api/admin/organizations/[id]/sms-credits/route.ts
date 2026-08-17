export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { addOrganizationSmsCredits } from '@/lib/services/billing.service';
import { TopUpSmsCreditsSchema } from '@/lib/validators/organization.schema';
import { ok, badRequest } from '@/lib/utils/response';

/**
 * POST /api/admin/organizations/[id]/sms-credits — super_admin grants/corrects
 * ANY organization's SMS balance. Previously impossible: no admin tool existed
 * to adjust this at all (a super_admin could only view it). Same underlying
 * function as the organization_coordinator's own self-serve top-up
 * (app/api/admin/organization/sms-credits/route.ts) — the org id comes from
 * the URL path here instead of the caller's own auth context.
 */
export function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withPlatformRole(req, 'super_admin', async (auth) => {
    const { id } = await params;
    const parsed = TopUpSmsCreditsSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);

    const result = await addOrganizationSmsCredits(
      id, parsed.data.amountKes, auth.userId,
      { reference: parsed.data.reference, notes: parsed.data.notes },
    );
    return ok(result, 201);
  });
}
