export const dynamic = 'force-dynamic'
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
 * C2B Paybill URL handler.
 *
 * GET  /api/v1/mpesa/c2b?type=validation    â€” Safaricom validation (must return 0 to accept)
 * POST /api/v1/mpesa/c2b?type=confirmation  â€” Safaricom confirmation (payment done)
 * POST /api/v1/mpesa/c2b?type=validation    â€” Safaricom validation via POST
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const type = req.nextUrl.searchParams.get('type');
  // Accept all inbound paybill transactions
  if (type === 'validation') {
    return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }
  return NextResponse.json({ ResultCode: 0, ResultDesc: 'OK' });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const type     = req.nextUrl.searchParams.get('type');
  const callerIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0';

  if (type === 'validation') {
    return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }

  // confirmation
  const rawBody = await req.text();
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
      logger.error('[c2b] Confirmation error:', err);
      if (callbackId) await markCallbackError(callbackId, String(err));
    }
  });

  return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' });
}
