export const dynamic = 'force-dynamic'
/**
 * GET /api/v1/mpesa/stk-query?checkoutRequestId=xxx
 * POST /api/v1/mpesa/stk-query  { checkoutRequestId }
 *
 * Queries Daraja for the actual status of a pending STK Push.
 * Used by the frontend during the payment flow and by the reconciliation engine.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/middleware';
import { queryStkStatus } from '@/lib/services/daraja.service';
import { getMpesaStatus } from '@/lib/redis';
import { ok, handleError } from '@/lib/utils/response';

const Schema = z.object({ checkoutRequestId: z.string().min(10) });

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async () => {
    try {
      const checkoutRequestId = req.nextUrl.searchParams.get('checkoutRequestId') ?? '';
      Schema.parse({ checkoutRequestId });

      // Fast path: Redis cache
      const cached = await getMpesaStatus(checkoutRequestId);
      if (cached && cached !== 'pending') {
        return ok({ status: cached, source: 'cache' });
      }

      // Slow path: ask Daraja directly
      const res = await queryStkStatus(checkoutRequestId);

      const status =
        res.resultCode === '0'  ? 'completed' :
        res.resultCode === '1032' ? 'pending' : 'failed';

      return ok({
        status,
        resultCode:   res.resultCode,
        resultDesc:   res.resultDesc,
        source:       'daraja',
      });
    } catch (err) {
      return handleError(err);
    }
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return withAuth(req, async () => {
    try {
      const { checkoutRequestId } = Schema.parse(await req.json());

      const cached = await getMpesaStatus(checkoutRequestId);
      if (cached && cached !== 'pending') {
        return ok({ status: cached, source: 'cache' });
      }

      const res    = await queryStkStatus(checkoutRequestId);
      const status =
        res.resultCode === '0'    ? 'completed' :
        res.resultCode === '1032' ? 'pending'   : 'failed';

      return ok({ status, resultCode: res.resultCode, resultDesc: res.resultDesc, source: 'daraja' });
    } catch (err) {
      return handleError(err);
    }
  });
}
