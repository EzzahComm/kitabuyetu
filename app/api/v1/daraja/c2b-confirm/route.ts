export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

/**
 * C2B Confirmation URL — DEPRECATED unauthenticated path.
 *
 * Phase 4: this static path carried no cryptographic authenticity check at
 * all (only an advisory, non-enforcing IP check), unlike every other Daraja
 * callback. It has been superseded by the token-authenticated dynamic route
 * at ./[token]/route.ts, whose token rides as a path segment (Safaricom's
 * registerurl API rejects a query string or the keyword "mpesa" in a
 * Confirmation/Validation URL, so a path segment is the only place a token
 * can ride here).
 *
 * This inert placeholder is kept ONLY for the cutover window: until someone
 * deliberately re-runs registerC2BUrls() against production (a separate,
 * explicitly-approved step — this file's existence changes nothing about
 * what Safaricom currently calls), Safaricom's registration still points at
 * THIS static path, and it must keep answering 200 "Accepted" so Safaricom
 * doesn't retry-storm a broken URL. It intentionally no longer calls
 * handleC2BConfirmation or performs any state change — a forged or
 * accidental POST here can no longer credit money. Delete this file (and
 * app/api/v1/daraja/c2b-validate/route.ts) once the new path-based URLs have
 * been confirmed live in Safaricom's registration for some time.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const callerIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0';
  logger.warn('[daraja/c2b-confirm] request hit deprecated unauthenticated path — ignored', {
    ip: callerIp,
  });
  return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' });
}
