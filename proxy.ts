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

// Union: tokens issued by /auth/login (tenant) carry groupId+role;
// tokens issued by /auth/admin/login (backoffice) carry platformRole.
// Legacy tokens without `aud` are treated as tenant for backward compat.
interface KyJwtPayload extends JWTPayload {
  sub:           string;
  aud?:          'tenant' | 'backoffice' | string;
  // Tenant claims
  groupId?:      string;
  role?:         string;
  // Phase D Part 2 — lifecycle gate. Missing = legacy token, treat as 'active'.
  groupStatus?:  string;
  // Backoffice claims
  platformRole?: string;
  ngoId?:        string;
}

function unauthorized(message: string): NextResponse {
  return NextResponse.json(
    { success: false, error: message, code: 'UNAUTHORIZED' },
    { status: 401 },
  );
}

function forbidden(message: string): NextResponse {
  return NextResponse.json(
    { success: false, error: message, code: 'FORBIDDEN' },
    { status: 403 },
  );
}

// ─── Main proxy: rate limiting + JWT verification ─────────────────────────────
export async function proxy(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  const isMpesaCallback =
    pathname.startsWith('/api/v1/mpesa/callback') ||
    pathname.startsWith('/api/v1/mpesa/c2b') ||
    pathname.startsWith('/api/v1/mpesa/b2c') ||
    pathname.startsWith('/api/v1/mpesa/b2b') ||
    pathname.startsWith('/api/v1/daraja/');   // registration-safe C2B callback paths

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

  // ── Audience matters only for /api/v1/* and /api/admin/* ───────────────
  // Everything else falls through (static, health, etc.).
  const isTenantApi     = pathname.startsWith('/api/v1/');
  const isBackofficeApi = pathname.startsWith('/api/admin/');
  if (!isTenantApi && !isBackofficeApi) {
    return NextResponse.next();
  }

  // These tenant paths are intentionally unauthenticated.
  // Webhooks authenticate via signed payloads (HMAC-SHA256, svix, ECDSA),
  // NOT by JWT, because external providers don't have access tokens.
  const isWebhook =
    pathname.startsWith('/api/v1/webhooks/') ||         // generic webhooks (WhatsApp Meta)
    pathname.startsWith('/api/v1/email/webhooks/');     // email provider callbacks (Resend, SendGrid)

  if (
    isTenantApi && (
      pathname.startsWith('/api/v1/auth/') ||         // login / register / refresh / admin-login
      pathname.startsWith('/api/v1/jurisdictions/') || // public reference data (counties etc.)
      isMpesaCallback ||
      isWebhook
    )
  ) {
    return NextResponse.next();
  }

  // ── JWT required from here on ─────────────────────────────────────────
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return unauthorized('Missing or malformed Authorization header');
  }
  const token = authHeader.slice(7);

  let payload: KyJwtPayload;
  try {
    const verified = await jwtVerify(token, ACCESS_SECRET, {
      algorithms: ['HS256'],
    }) as { payload: KyJwtPayload };
    payload = verified.payload;
  } catch {
    return unauthorized('Invalid or expired token');
  }

  if (!payload.sub) {
    return unauthorized('Incomplete token payload');
  }

  // Default to 'tenant' for legacy tokens that pre-date Phase 1.
  const aud: 'tenant' | 'backoffice' =
    payload.aud === 'backoffice' ? 'backoffice' : 'tenant';

  // ── Enforce audience match per URL prefix ────────────────────────────
  if (isBackofficeApi && aud !== 'backoffice') {
    return forbidden('This route requires a backoffice session. Sign in at /admin-login.');
  }
  if (isTenantApi && aud !== 'tenant') {
    return forbidden('This route requires a tenant session. Sign in at /login.');
  }

  // ── Stamp verified claims as request headers ─────────────────────────
  // API routes read these via getAuthContext / getBackofficeContext
  // without re-verifying the JWT.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-user-id', payload.sub);
  requestHeaders.set('x-aud',     aud);

  if (aud === 'tenant') {
    if (!payload.groupId || !payload.role) {
      return unauthorized('Incomplete tenant token payload');
    }
    requestHeaders.set('x-group-id', payload.groupId);
    requestHeaders.set('x-role',     payload.role);
    const groupStatus = payload.groupStatus ?? 'active';
    requestHeaders.set('x-group-status', groupStatus);
    if (payload.ngoId) requestHeaders.set('x-ngo-id', payload.ngoId);

    // Phase D Part 2 — gate feature routes while group is awaiting
    // verification. The verify endpoints + minimal session-management
    // endpoints stay open so the registrant can complete the flow.
    if (groupStatus === 'pending_verification') {
      const allowedPending =
        pathname.startsWith('/api/v1/auth/me')      ||
        pathname.startsWith('/api/v1/auth/refresh') ||
        pathname.startsWith('/api/v1/auth/logout')  ||
        pathname.startsWith('/api/v1/auth/verify/');
      if (!allowedPending) {
        return NextResponse.json(
          {
            success: false,
            error:   'Group not verified yet — complete verification at /verify-group',
            code:    'PENDING_VERIFICATION',
          },
          { status: 403 },
        );
      }
    }
  } else {
    if (!payload.platformRole) {
      return unauthorized('Incomplete backoffice token payload');
    }
    requestHeaders.set('x-platform-role', payload.platformRole);
    if (payload.ngoId) requestHeaders.set('x-ngo-id', payload.ngoId);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/api/:path*'],
};
