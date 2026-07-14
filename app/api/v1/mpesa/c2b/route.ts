export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse, after } from 'next/server';
import {
  handleC2BConfirmation,
  validateC2BAccount,
  logMpesaCallback,
  markCallbackProcessed,
  markCallbackError,
  type C2BCallbackBody,
} from '@/lib/services/mpesa.service';
import { checkRateLimit } from '@/lib/redis';
import { logger } from '@/lib/logger';

/**
 * C2B Paybill URL handler.
 *
 * GET  /api/v1/mpesa/c2b?type=validation    — URL health check (no body → accept)
 * POST /api/v1/mpesa/c2b?type=validation    — Safaricom pre-payment validation
 * POST /api/v1/mpesa/c2b?type=confirmation  — Safaricom confirmation (payment done)
 *
 * Validation is REAL (payment architecture §3.2): membership-number-shaped
 * account numbers are checked (Damm digit, registry, payment eligibility)
 * BEFORE the member's money moves — a typo'd number bounces at the till
 * instead of becoming unrouted-queue toil. Everything else (legacy KYT refs,
 * invoice numbers) is accepted and routed at confirmation, unchanged.
 * Fail-open on any internal error. Disable via MPESA_C2B_VALIDATION=false.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const type = req.nextUrl.searchParams.get('type');
  if (type === 'validation') {
    return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }
  return NextResponse.json({ ResultCode: 0, ResultDesc: 'OK' });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const type     = req.nextUrl.searchParams.get('type');
  const callerIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0';

  if (type === 'validation') {
    return handleValidation(req, callerIp);
  }

  // confirmation
  const rawBody = await req.text();
  let body: C2BCallbackBody;
  try {
    body = JSON.parse(rawBody) as C2BCallbackBody;
  } catch {
    return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }

  // Ack-after-durable-audit (ADR-19): persist the raw callback before acking;
  // on audit failure return non-200 so Safaricom retries instead of the
  // payment being silently lost. See mpesa/callback/route.ts for detail.
  const callbackId = await logMpesaCallback('c2b_confirmation', callerIp, rawBody);
  if (!callbackId && DURABLE_ACK) {
    logger.error('[c2b] audit write failed — asking Safaricom to retry');
    return NextResponse.json({ ResultCode: 1, ResultDesc: 'Retry' }, { status: 503 });
  }

  after(async () => {
    try {
      await handleC2BConfirmation(body, callerIp);
      if (callbackId) await markCallbackProcessed(callbackId);
    } catch (err) {
      logger.error('[c2b] Confirmation error:', err);
      if (callbackId) await markCallbackError(callbackId, String(err));
    }
  });

  return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' });
}

interface C2BValidationBody {
  TransID?:       string;
  TransAmount?:   string;
  BillRefNumber?: string;
  MSISDN?:        string;
}

async function handleValidation(req: NextRequest, callerIp: string): Promise<NextResponse> {
  if (!VALIDATION_ENABLED) return accept();

  let body: C2BValidationBody;
  try {
    body = (await req.json()) as C2BValidationBody;
  } catch {
    return accept(); // malformed validation payload — never block money on our parsing
  }

  // Abuse control: validation lookups are an enumeration surface for account
  // numbers. Budget generous enough for any legitimate payer (fail-open in
  // the limiter itself on Redis loss).
  const limitKey = `c2b_val:${body.MSISDN ?? callerIp}`;
  if (!(await checkRateLimit(limitKey, 20, 60))) {
    logger.warn('[c2b/validation] rate limited', { msisdn: body.MSISDN, callerIp });
    return reject();
  }

  const verdict = await validateC2BAccount(body.BillRefNumber);
  if (verdict.accept) return accept();

  logger.info('[c2b/validation] rejected account', {
    billRef: body.BillRefNumber, reason: verdict.reason, msisdn: body.MSISDN,
  });
  return reject();
}

function accept(): NextResponse {
  return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' });
}

// C2B00012 = "Invalid Account Number" — the payer sees the rejection on their
// phone and can correct the account number before any money moves.
function reject(): NextResponse {
  return NextResponse.json({ ResultCode: 'C2B00012', ResultDesc: 'Rejected' });
}

// Config escape hatches (rollback levers per the Phase 1 plan):
//   MPESA_C2B_VALIDATION=false → validation accepts everything (legacy behaviour)
//   MPESA_DURABLE_ACK=false    → unconditional 200-ack on confirmation
const VALIDATION_ENABLED = process.env.MPESA_C2B_VALIDATION !== 'false';
const DURABLE_ACK        = process.env.MPESA_DURABLE_ACK !== 'false';
