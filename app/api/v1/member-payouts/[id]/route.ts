export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withMemberPayoutAccess } from '@/lib/auth/member-payout-access';
import { memberPayoutsService } from '@/lib/services/member-payouts.service';
import { ok, handleError } from '@/lib/utils/response';
import { MemberPayoutActionSchema } from '@/lib/validators/mpesa.schema';

type Ctx = { params: Promise<{ id: string }> };

/** GET — review record: disbursement, group/member impact, audit trail. */
export async function GET(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withMemberPayoutAccess(req, async (ctx) => {
    try {
      return ok(await memberPayoutsService.getDetail(ctx, id));
    } catch (err) {
      return handleError(err);
    }
  });
}

/**
 * POST — { action: 'approve' } / { action: 'reject', reason } (treasurer, not
 * the initiator) or { action: 'cancel' } (the initiator, before money moves).
 */
export async function POST(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withMemberPayoutAccess(req, async (ctx) => {
    try {
      const input = MemberPayoutActionSchema.parse(await req.json());
      if (input.action === 'approve') return ok(await memberPayoutsService.treasurerApprove(ctx, id));
      if (input.action === 'reject') return ok(await memberPayoutsService.treasurerReject(ctx, id, input.reason));
      return ok(await memberPayoutsService.cancel(ctx, id));
    } catch (err) {
      return handleError(err);
    }
  });
}
