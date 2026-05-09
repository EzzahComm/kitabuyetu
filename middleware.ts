import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify, type JWTPayload } from 'jose';

const ACCESS_SECRET = new TextEncoder().encode(process.env.JWT_SECRET ?? '');

interface KyJwtPayload extends JWTPayload {
  sub:     string;
  groupId: string;
  role:    string;
  ngoId?:  string;
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  // Only protect /api/v1/* routes
  if (!pathname.startsWith('/api/v1/')) {
    return NextResponse.next();
  }

  // Auth endpoints are open
  if (pathname.startsWith('/api/v1/auth/')) {
    return NextResponse.next();
  }

  // M-Pesa inbound callbacks carry no JWT — Safaricom posts to these URLs directly.
  // IP validation is done inside each route handler.
  // NOTE: balance, reversal, stk-push, stk-query, and transaction-status are
  // outbound actions initiated by authenticated users and MUST require JWT (not listed here).
  if (
    pathname.startsWith('/api/v1/mpesa/callback') ||
    pathname.startsWith('/api/v1/mpesa/c2b') ||
    pathname.startsWith('/api/v1/mpesa/b2c') ||
    pathname.startsWith('/api/v1/mpesa/b2b')
  ) {
    return NextResponse.next();
  }

  // Public group listing — used by login page before user authenticates
  if (pathname === '/api/v1/groups') {
    return NextResponse.next();
  }

  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return unauthorized('Missing or malformed Authorization header');
  }

  const token = authHeader.slice(7);

  try {
    const { payload } = await jwtVerify(token, ACCESS_SECRET) as { payload: KyJwtPayload };

    if (!payload.sub || !payload.groupId || !payload.role) {
      return unauthorized('Incomplete token payload');
    }

    // Stamp claims as request headers so API routes can read them
    // without re-verifying the token (edge already did that).
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set('x-user-id',  payload.sub);
    requestHeaders.set('x-group-id', payload.groupId);
    requestHeaders.set('x-role',     payload.role);
    if (payload.ngoId) {
      requestHeaders.set('x-ngo-id', payload.ngoId);
    }

    return NextResponse.next({ request: { headers: requestHeaders } });
  } catch {
    return unauthorized('Invalid or expired token');
  }
}

function unauthorized(message: string): NextResponse {
  return NextResponse.json(
    { success: false, error: message, code: 'UNAUTHORIZED' },
    { status: 401 },
  );
}

export const config = {
  matcher: ['/api/v1/:path*'],
};
