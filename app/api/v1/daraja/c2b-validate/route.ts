export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

/**
 * C2B Validation URL — DEPRECATED unauthenticated path.
 *
 * This handler was already a true no-op (validation never changes state —
 * see ./[token]/route.ts for the current rationale), so hardening it is
 * lower value than c2b-confirm, but it's done anyway for consistency: Phase 4
 * moved the live, token-authenticated Validation URL to the dynamic route at
 * ./[token]/route.ts, whose token rides as a path segment (Safaricom's
 * registerurl API rejects a query string or the keyword "mpesa" here).
 *
 * Kept ONLY as an inert placeholder for the cutover window: until someone
 * deliberately re-runs registerC2BUrls() against production (a separate,
 * explicitly-approved step — this file's existence changes nothing about
 * what Safaricom currently calls), Safaricom's registration still points at
 * THIS static path, and it must keep answering 200 "Accepted" so Safaricom
 * doesn't retry-storm a broken URL. Delete this file (and
 * app/api/v1/daraja/c2b-confirm/route.ts) once the new path-based URLs have
 * been confirmed live in Safaricom's registration for some time.
 */
function accept(): NextResponse {
  return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' });
}

function warnDeprecated(req: NextRequest): void {
  const callerIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0';
  logger.warn('[daraja/c2b-validate] request hit deprecated unauthenticated path — ignored', {
    ip: callerIp,
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  warnDeprecated(req);
  return accept();
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  warnDeprecated(req);
  return accept();
}
