export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withMemberPayoutAccess } from '@/lib/auth/member-payout-access';
import { disbursementsService } from '@/lib/services/disbursements.service';
import { memberPayoutsService } from '@/lib/services/member-payouts.service';
import { ok, handleError, errorResponse } from '@/lib/utils/response';
import { MemberPayoutListSchema, MemberPayoutSchema } from '@/lib/validators/mpesa.schema';

/** GET /api/v1/member-payouts — the group's member disbursements (officers). */
export async function GET(req: NextRequest): Promise<Response> {
  return withMemberPayoutAccess(req, async (ctx) => {
    try {
      const params = MemberPayoutListSchema.parse(Object.fromEntries(req.nextUrl.searchParams));
      return ok(await disbursementsService.list(ctx, { ...params, kind: 'member_payout' }));
    } catch (err) {
      return handleError(err);
    }
  });
}

/**
 * POST /api/v1/member-payouts — the chairperson or secretary submits a member
 * disbursement. Funds are reserved; it then needs the treasurer's approval
 * and Kitabu Yetu's sign-off before any money moves.
 */
export async function POST(req: NextRequest): Promise<Response> {
  return withMemberPayoutAccess(req, async (ctx) => {
    try {
      const idempotencyKey = req.headers.get('idempotency-key');
      if (!idempotencyKey) {
        return errorResponse(
          'An Idempotency-Key header is required to submit a disbursement',
          'IDEMPOTENCY_KEY_REQUIRED',
          400,
        );
      }
      const input = MemberPayoutSchema.parse(await req.json());
      const row = await memberPayoutsService.initiate(ctx, { ...input, idempotencyKey });
      return ok({ id: row.id, reference: row.reference, status: row.status });
    } catch (err) {
      return handleError(err);
    }
  });
}
