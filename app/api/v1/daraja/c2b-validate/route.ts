export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { validateC2BAccount } from '@/lib/services/mpesa.service';
import { checkRateLimit } from '@/lib/redis';
import { logger } from '@/lib/logger';

/**
 * C2B Validation URL — registration-safe path.
 *
 * Safaricom's registerurl API rejects Confirmation/Validation URLs that
 * contain the keyword "mpesa" or a query string, so the live C2B URLs live
 * under /api/v1/daraja/ (no blocked keyword, no `?type=`) instead of the
 * internal /api/v1/mpesa/c2b handler.
 *
 * Validation fires BEFORE the customer is debited (payment architecture
 * §3.2 / ADR-7). Membership-number-shaped account numbers are checked
 * (Damm digit, registry, payment eligibility) before the member's money
 * moves — a typo'd number bounces at the till instead of becoming unrouted-
 * queue toil. Everything else (legacy KYT refs, invoice numbers) is
 * accepted and routed at confirmation, unchanged. Fail-open on any internal
 * error — this route must never block a legitimate payment.
 *
 * PREVIOUSLY this route unconditionally accepted every account number,
 * carrying only a stale "matching the prior behaviour" comment — the real
 * check above was built (2026-07-14, multi-group payment architecture) but
 * landed on the unregistered, unreachable /api/v1/mpesa/c2b?type=validation
 * responder instead of here, so ADR-7's "C2B Validation actively rejects"
 * commitment never actually reached Safaricom. Ported over rather than
 * left where nothing could ever call it.
 */
function accept(): NextResponse {
  return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' });
}

// C2B00012 = "Invalid Account Number" — the payer sees the rejection on
// their phone and can correct the account number before any money moves.
function reject(): NextResponse {
  return NextResponse.json({ ResultCode: 'C2B00012', ResultDesc: 'Rejected' });
}

interface C2BValidationBody {
  TransID?:       string;
  TransAmount?:   string;
  BillRefNumber?: string;
  MSISDN?:        string;
}

// MPESA_C2B_VALIDATION=false → accept everything (legacy/rollback behaviour).
const VALIDATION_ENABLED = process.env.MPESA_C2B_VALIDATION !== 'false';

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!VALIDATION_ENABLED) return accept();

  const callerIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0';

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
    logger.warn('[daraja/c2b-validate] rate limited', { msisdn: body.MSISDN, callerIp });
    return reject();
  }

  const verdict = await validateC2BAccount(body.BillRefNumber);
  if (verdict.accept) return accept();

  logger.info('[daraja/c2b-validate] rejected account', {
    billRef: body.BillRefNumber, reason: verdict.reason, msisdn: body.MSISDN,
  });
  return reject();
}

export async function GET(): Promise<NextResponse> {
  return accept();
}
