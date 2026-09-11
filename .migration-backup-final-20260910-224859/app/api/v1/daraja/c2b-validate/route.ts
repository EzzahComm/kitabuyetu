export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';

/**
 * C2B Validation URL — registration-safe path.
 *
 * Safaricom's registerurl API rejects Confirmation/Validation URLs that
 * contain the keyword "mpesa" or a query string, so the live C2B URLs live
 * under /api/v1/daraja/ (no blocked keyword, no `?type=`) instead of the
 * internal /api/v1/mpesa/c2b handler.
 *
 * Validation fires BEFORE the customer is debited. We accept all inbound
 * PayBill transactions (ResponseType=Completed is registered, so Safaricom
 * also auto-completes if this URL is ever unreachable). Returning a non-zero
 * ResultCode here would reject the payment — we don't, matching the prior
 * behaviour of the /mpesa/c2b?type=validation responder.
 */
function accept(): NextResponse {
  return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' });
}

export async function POST(): Promise<NextResponse> {
  return accept();
}

export async function GET(): Promise<NextResponse> {
  return accept();
}
