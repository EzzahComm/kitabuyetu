export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { isValidCallbackToken } from '@/lib/services/daraja.service';
import { logger } from '@/lib/logger';

/**
 * C2B Validation URL — token-authenticated path (Phase 4).
 *
 * Safaricom's registerurl API rejects Confirmation/Validation URLs that
 * contain the keyword "mpesa" or a query string, so — same as
 * ../c2b-confirm/[token]/route.ts — the shared authenticity token rides as
 * this route's `[token]` PATH SEGMENT instead of a `?token=` query param.
 *
 * This handler is a true no-op regardless of the token: validation fires
 * BEFORE the customer is debited, and we accept all inbound PayBill
 * transactions (ResponseType=Completed is registered, so Safaricom also
 * auto-completes if this URL is ever unreachable). Returning a non-zero
 * ResultCode here would reject the payment — we don't. The token check still
 * runs and logs a mismatch for observability, but since nothing here changes
 * state either way, an invalid token gets exactly the same 200 Accepted ack.
 *
 * See ../route.ts (the old no-token path) for the inert placeholder kept
 * during the cutover window.
 */
function accept(): NextResponse {
  return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' });
}

async function handle(req: NextRequest, { params }: { params: Promise<{ token: string }> }): Promise<NextResponse> {
  const { token } = await params;
  if (!isValidCallbackToken(token)) {
    const callerIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0';
    logger.warn('[daraja/c2b-validate] invalid or missing token — dropped', { ip: callerIp });
  }
  return accept();
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  return handle(req, ctx);
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  return handle(req, ctx);
}
