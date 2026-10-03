export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse, after } from 'next/server';
import {
  handleC2BConfirmation,
  logMpesaCallback,
  markCallbackProcessed,
  markCallbackError,
  type C2BCallbackBody,
} from '@/lib/services/mpesa.service';
import { isValidCallbackToken } from '@/lib/services/daraja.service';
import { logger } from '@/lib/logger';

const ack = () => NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' });

/**
 * C2B Confirmation URL — token-authenticated path (Phase 4).
 *
 * Safaricom's registerurl API rejects any Confirmation/Validation URL that
 * contains a query string or the keyword "mpesa" (see the comment on
 * getC2BUrls() in lib/services/daraja.service.ts), so unlike every other
 * Daraja callback the shared authenticity token can't ride a `?token=` query
 * param here — it rides as this route's `[token]` PATH SEGMENT instead. A
 * request whose token doesn't match is acked exactly like a valid one (never
 * a different HTTP status) so a prober learns nothing from the response, but
 * is dropped before `handleC2BConfirmation` — which performs REAL state
 * changes (crediting contributions/welfare/loan repayments) — ever runs.
 *
 * Fires AFTER a successful PayBill payment. Must return HTTP 200 with
 * ResultCode 0 immediately — Safaricom retries on anything else — so the
 * routing/fulfilment work is offloaded to a background task. The raw callback
 * is audited and the row marked processed/errored for the DLQ replay job.
 *
 * See ../route.ts (the old no-token path) for the inert placeholder kept
 * during the cutover window.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;
  const callerIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0';

  if (!isValidCallbackToken(token)) {
    logger.warn('[daraja/c2b-confirm] invalid or missing token — dropped', { ip: callerIp });
    return ack();
  }

  const rawBody = await req.text();

  let body: C2BCallbackBody;
  try {
    body = JSON.parse(rawBody) as C2BCallbackBody;
  } catch {
    return ack();
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

  return ack();
}
