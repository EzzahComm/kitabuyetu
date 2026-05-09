export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { getMpesaStatus } from '@/lib/redis';
import { withAdminDb } from '@/lib/db';
import { ok, errorResponse } from '@/lib/utils/response';

/**
 * Poll the status of an STK Push request.
 * Frontend polls this every 3 seconds while waiting for the user to enter PIN.
 * Redis cache avoids hammering the DB for every poll.
 */
export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const checkoutRequestId = req.nextUrl.searchParams.get('checkoutRequestId');
    if (!checkoutRequestId) {
      return errorResponse('checkoutRequestId query param is required', 'VALIDATION_ERROR', 422);
    }

    // Try Redis cache first (fast path)
    const cached = await getMpesaStatus(checkoutRequestId);
    if (cached) {
      return ok({ status: cached, checkoutRequestId });
    }

    // Fall back to DB
    const payment = await withAdminDb(async (db) => {
      const { rows } = await db.query<{ status: string; mpesa_receipt_number: string | null }>(
        `SELECT status, mpesa_receipt_number
         FROM payments
         WHERE mpesa_checkout_request_id = $1 AND group_id = $2
         LIMIT 1`,
        [checkoutRequestId, auth.groupId],
      );
      return rows[0] ?? null;
    });

    if (!payment) {
      return errorResponse('Payment not found', 'NOT_FOUND', 404);
    }

    return ok({
      status:               payment.status,
      checkoutRequestId,
      mpesaReceiptNumber:   payment.mpesa_receipt_number,
    });
  });
}
