export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse, after } from 'next/server';
import {
  handleC2BConfirmation,
  logMpesaCallback,
  markCallbackProcessed,
  markCallbackError,
  type C2BCallbackBody,
} from '@/lib/services/mpesa.service';
import { logger } from '@/lib/logger';

/**
 * C2B Confirmation URL — registration-safe path (see c2b-validate for why
 * these live under /api/v1/daraja/ rather than /api/v1/mpesa/c2b).
 *
 * Fires AFTER a successful PayBill payment. Must return HTTP 200 with
 * ResultCode 0 immediately — Safaricom retries on anything else — so the
 * routing/fulfilment work is offloaded to a background task. The raw callback
 * is audited and the row marked processed/errored for the DLQ replay job.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const callerIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0';
  const rawBody  = await req.text();

  let body: C2BCallbackBody;
  try {
    body = JSON.parse(rawBody) as C2BCallbackBody;
  } catch {
    return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }

  after(async () => {
    const callbackId = await logMpesaCallback('c2b_confirmation', callerIp, rawBody);
    try {
      await handleC2BConfirmation(body, callerIp);
      if (callbackId) await markCallbackProcessed(callbackId);
    } catch (err) {
      logger.error('[daraja/c2b-confirm] Confirmation error:', err);
      if (callbackId) await markCallbackError(callbackId, String(err));
    }
  });

  return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' });
}
