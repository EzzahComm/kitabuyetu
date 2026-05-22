export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { handleC2BConfirmation, type C2BCallbackBody } from '@/lib/services/mpesa.service';
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
  let body: C2BCallbackBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }

  setImmediate(async () => {
    try {
      await handleC2BConfirmation(body, callerIp);
    } catch (err) {
      logger.error('[c2b] Confirmation error:', err);
    }
  });

  return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' });
}
