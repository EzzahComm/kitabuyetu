export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withMemberPayoutAccess } from '@/lib/auth/member-payout-access';
import { getPayoutEligibility } from '@/lib/services/member-payouts.service';
import { ok, handleError } from '@/lib/utils/response';

const QuerySchema = z.object({ memberId: z.string().uuid() });

/** GET ?memberId= — recipient phone, withdrawable savings and available group funds for the form. */
export async function GET(req: NextRequest): Promise<Response> {
  return withMemberPayoutAccess(req, async (ctx) => {
    try {
      const { memberId } = QuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
      return ok(await getPayoutEligibility(ctx, memberId));
    } catch (err) {
      return handleError(err);
    }
  });
}
