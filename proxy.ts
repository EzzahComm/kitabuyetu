import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify, type JWTPayload } from 'jose';

// ─── Rate limiting (Upstash REST — Edge-compatible) ───────────────────────────
// Fails open on any Redis error so downtime never blocks legitimate traffic.
const RL_LIMIT  = 120; // requests per window
const RL_WINDOW = 60;  // window in seconds

async function checkRateLimit(ip: string): Promise<boolean> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return true;

  try {
    const url   = new URL(redisUrl);
    const token = url.password;
    const base  = `https://${url.hostname}`;
    const key   = `rl:api:${ip}`;

    // INCR + EXPIRE NX in a single atomic pipeline call. EXPIRE NX only
    // sets the TTL when the key has no TTL yet — so subsequent hits within
    // the same window don't reset the clock (fixed-window behaviour) and
    // the previous "stuck counter" failure mode (where a fire-and-forget
    // EXPIRE silently failed and the key lived forever without TTL,
    // permanently blocking the IP) is eliminated.
    const res = await fetch(`${base}/pipeline`, {
      method:  'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        ['INCR',   key],
        ['EXPIRE', key, String(RL_WINDOW), 'NX'],
      ]),
    });
    if (!res.ok) return true;

    const body = await res.json() as Array<{ result?: number; error?: string }>;
    const count = body[0]?.result ?? 0;

    return count <= RL_LIMIT;
  } catch {
    return true; // fail open
  }
}

// ─── JWT verification ──────────────────────────────────────────────────────────
const rawSecret = process.env.JWT_SECRET;
if (!rawSecret || rawSecret.length < 32) {
  throw new Error('[proxy] JWT_SECRET must be set and at least 32 characters');
}
const ACCESS_SECRET = new TextEncoder().encode(rawSecret);

interface KyJwtPayload extends JWTPayload {
  sub:     string;
  groupId: string;
  role:    string;
  ngoId?:  string;
}

function unauthorized(message: string): NextResponse {
  return NextResponse.json(
    { success: false, error: message, code: 'UNAUTHORIZED' },
    { status: 401 },
  );
}

// ─── Main proxy: rate limiting + JWT verification ─────────────────────────────
export async function proxy(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  const isMpesaCallback =
    pathname.startsWith('/api/v1/mpesa/callback') ||
    pathname.startsWith('/api/v1/mpesa/c2b') ||
    pathname.startsWith('/api/v1/mpesa/b2c') ||
    pathname.startsWith('/api/v1/mpesa/b2b');

  // Rate-limit all API routes except M-Pesa callbacks (Safaricom retries on non-200)
  if (pathname.startsWith('/api/') && !isMpesaCallback) {
    const ip = (
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      req.headers.get('x-real-ip') ??
      '0.0.0.0'
    );
    const allowed = await checkRateLimit(ip);
    if (!allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests', code: 'RATE_LIMITED' },
        { status: 429, headers: { 'Retry-After': String(RL_WINDOW) } },
      );
    }
  }

  // JWT verification is only required for /api/v1/* routes
  if (!pathname.startsWith('/api/v1/')) {
    return NextResponse.next();
  }

  // These paths are intentionally unauthenticated.
  // Webhooks are authenticated by their own signatures (HMAC-SHA256 for
  // WhatsApp, svix for Resend, etc.) — NOT by JWT — because external
  // providers don't have access tokens.
  const isWebhook =
    pathname.startsWith('/api/v1/webhooks/') ||         // generic webhooks (e.g. WhatsApp Meta Cloud API)
    pathname.startsWith('/api/v1/email/webhooks/');     // email provider callbacks (Resend, SendGrid)

  if (
    pathname.startsWith('/api/v1/auth/') ||
    pathname.startsWith('/api/v1/jurisdictions/') ||  // public reference data (counties/sub-counties/wards) for registration dropdowns
    isMpesaCallback ||
    isWebhook
  ) {
    return NextResponse.next();
  }

  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return unauthorized('Missing or malformed Authorization header');
  }

  const token = authHeader.slice(7);

  try {
    // algorithms: ['HS256'] pins the algorithm and prevents confusion attacks
    const { payload } = await jwtVerify(token, ACCESS_SECRET, {
      algorithms: ['HS256'],
    }) as { payload: KyJwtPayload };

    if (!payload.sub || !payload.groupId || !payload.role) {
      return unauthorized('Incomplete token payload');
    }

    // Stamp verified claims as request headers — API routes read these without re-verifying
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set('x-user-id',  payload.sub);
    requestHeaders.set('x-group-id', payload.groupId);
    requestHeaders.set('x-role',     payload.role);
    if (payload.ngoId) requestHeaders.set('x-ngo-id', payload.ngoId);

    return NextResponse.next({ request: { headers: requestHeaders } });
  } catch {
    return unauthorized('Invalid or expired token');
  }
}

export const config = {
  matcher: ['/api/:path*'],
};
