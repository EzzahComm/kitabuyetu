import { NextRequest, NextResponse, after } from 'next/server';
import {
  handleSTKCallback,
  logMpesaCallback,
  markCallbackProcessed,
  markCallbackError,
  runStkPostCommitEffects,
  type StkCallbackBody,
} from '@/lib/services/mpesa.service';
import { isSafaricomIp, isValidCallbackToken } from '@/lib/services/daraja.service';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * STK Push callback from Safaricom.
 * Must return HTTP 200 immediately — Safaricom retries on any other response.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const callerIp = getCallerIp(req);

  // Origin check is advisory only — behind Vercel's edge + custom domains the
  // forwarded client IP is not a reliable Safaricom IP, so hard-blocking here
  // drops legitimate callbacks (every payment silently stays pending).
  // Integrity instead comes from: the append-only mpesa_callbacks audit, the
  // UNIQUE(mpesa_receipt_number) idempotency, callbacks only acting on rows the
  // app itself initiated, and reconciliation/STK-Query as source of truth.
  // We log the caller IP so the allow-list can be re-tightened with real values.
  if (!isSafaricomIp(callerIp)) {
    logger.warn('[mpesa/callback] caller IP not in Safaricom allow-list — processing anyway', { callerIp });
  }

  // Callback authenticity (Phase 4 — same mechanism as B2C/B2B): the
  // CallBackURL Daraja was given at STK-push time (initiateStkPush,
  // daraja.service.ts) carries `?token=`. A forged/replayed POST that
  // doesn't know the secret is dropped before it can touch any payment
  // state. Acked (not rejected) so a prober learns nothing from the
  // response, and logged so a real misconfiguration is visible.
  if (!isValidCallbackToken(req.nextUrl.searchParams.get('token'))) {
    logger.warn('[mpesa/callback] invalid or missing token — dropped', { callerIp });
    return ack();
  }

  const rawBody = await req.text();

  let body: StkCallbackBody;
  try {
    body = JSON.parse(rawBody) as StkCallbackBody;
  } catch {
    return ack();
  }

  // Ack-after-durable-audit (ADR-19): the raw callback must be durably
  // persisted BEFORE we return 200. If the audit insert fails (e.g. DB down),
  // a non-200 makes Safaricom retry — previously we acked unconditionally and
  // a callback arriving during an outage was silently lost. The DLQ replay
  // job recovers processing failures from the audit row.
  const callbackId = await logMpesaCallback('stk_push', callerIp, rawBody);
  if (!callbackId && DURABLE_ACK) {
    logger.error('[mpesa/callback] audit write failed — asking Safaricom to retry');
    return NextResponse.json({ ResultCode: 1, ResultDesc: 'Retry' }, { status: 503 });
  }

  after(async () => {
    try {
      const result = await handleSTKCallback(body, callerIp);
      if (result.success && result.paymentId && result.amount) {
        await runStkPostCommitEffects(result.paymentId, result.amount);
      }
      if (callbackId) await markCallbackProcessed(callbackId);
    } catch (err) {
      logger.error('[mpesa/callback] Processing error:', err);
      if (callbackId) await markCallbackError(callbackId, String(err));
    }
  });

  return ack();
}

// Config escape hatch: set MPESA_DURABLE_ACK=false to restore the legacy
// unconditional 200-ack (e.g. while diagnosing audit-table issues).
const DURABLE_ACK = process.env.MPESA_DURABLE_ACK !== 'false';

function getCallerIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? '0.0.0.0';
}

function ack(): NextResponse {
  return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' });
}
