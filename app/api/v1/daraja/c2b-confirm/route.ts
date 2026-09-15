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
 * ResultCode 0 immediately for the general case — Safaricom retries on
 * anything else — so the routing/fulfilment work is offloaded to a
 * background task. The raw callback is audited and the row marked
 * processed/errored for the DLQ replay job.
 *
 * Ack-after-durable-audit (ADR-19): the callback is persisted BEFORE
 * acking; on audit-write failure this returns non-200 so Safaricom retries
 * instead of the payment being silently lost — Safaricom's own retry
 * becomes the durability mechanism, superseding an unconditional 200-ack.
 * PREVIOUSLY this route acked unconditionally and only audited inside the
 * fire-and-forget after() block — ADR-19 (Accepted v3, Phase 0 "stop the
 * bleeding") was built (2026-07-14) but landed on the unregistered,
 * unreachable /api/v1/mpesa/c2b?type=confirmation responder instead of
 * here, so this route — the one Safaricom actually calls — never got it.
 * Ported over rather than left where nothing could ever call it. Matches
 * app/api/v1/mpesa/callback/route.ts's STK-side implementation of the same
 * ADR.
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

  const callbackId = await logMpesaCallback('c2b_confirmation', callerIp, rawBody);
  if (!callbackId && DURABLE_ACK) {
    logger.error('[daraja/c2b-confirm] audit write failed — asking Safaricom to retry');
    return NextResponse.json({ ResultCode: 1, ResultDesc: 'Retry' }, { status: 503 });
  }

  after(async () => {
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

// MPESA_DURABLE_ACK=false → unconditional 200-ack on confirmation (rollback lever).
const DURABLE_ACK = process.env.MPESA_DURABLE_ACK !== 'false';
