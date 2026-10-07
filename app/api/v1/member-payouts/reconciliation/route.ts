export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withMemberPayoutAccess } from '@/lib/auth/member-payout-access';
import { getReconciliation, repostMissingJournals } from '@/lib/services/member-payouts.service';
import { ok, handleError } from '@/lib/utils/response';

/** GET — per-disbursement proof that the group ledger and member ledgers agree. */
export async function GET(req: NextRequest): Promise<Response> {
  return withMemberPayoutAccess(req, async (ctx) => {
    try {
      return ok(await getReconciliation(ctx));
    } catch (err) {
      return handleError(err);
    }
  });
}

/** POST — post the journal for completed M-Pesa disbursements that have none (idempotent). */
export async function POST(req: NextRequest): Promise<Response> {
  return withMemberPayoutAccess(req, async (ctx) => {
    try {
      const result = await repostMissingJournals(ctx);
      return ok({ ...result, reconciliation: await getReconciliation(ctx) });
    } catch (err) {
      return handleError(err);
    }
  });
}
