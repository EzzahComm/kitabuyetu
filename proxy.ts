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
  // Active Membership Context + drift epochs (payment architecture §2.1/§2.5).
  // Missing on tokens issued before Phase 3.2.
  membershipId?:   string;
  membershipNo?:   string;
  authVersion?:    number;
  sessionVersion?: number;
  // RBAC permission activation — resolved at issue time from
  // group_members.role_id -> roles.permissions. Missing on legacy tokens.
  permissions?:    string[];
  // Backoffice claims
  platformRole?: string;
  organizationId?:        string;
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

// Claim headers stamped by this proxy after JWT verification. Inbound copies
// are stripped from EVERY request (including unauthenticated fall-throughs)
// so a client can never smuggle its own claims to a handler — belt-and-
// suspenders even though the unauthenticated handlers don't read them.
const CLAIM_HEADERS = [
  'x-user-id', 'x-aud', 'x-group-id', 'x-role',
  'x-group-status', 'x-organization-id', 'x-platform-role',
  'x-membership-id', 'x-membership-no', 'x-auth-version', 'x-session-version',
  'x-permissions',
] as const;

function sanitizedHeaders(req: NextRequest): Headers {
  const headers = new Headers(req.headers);
  for (const h of CLAIM_HEADERS) headers.delete(h);
  return headers;
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
    return NextResponse.next({ request: { headers: sanitizedHeaders(req) } });
  }

  // The organization API tree used to live at /api/v1/organization/* and
  // needed a carve-out here so a BACKOFFICE token (the only kind
  // organization_coordinator/super_admin can hold since the org-login split)
  // could reach a tenant-audience path at all. That carve-out reshaped the
  // claims to look tenant-ish, including `x-group-id: ''` because the tree is
  // organization-scoped and no handler reads a group.
  //
  // It never worked: getAuthContext guards with `!groupId`, and '' is falsy in
  // JavaScript, so every organization request threw "Missing authentication
  // context" and the enterprise Portfolio dashboard could never load. Rather
  // than loosen that guard — and keep stamping `x-aud: 'tenant'` onto a token
  // that is genuinely backoffice — the tree moved to /api/admin/organization/*,
  // the bucket whose token it actually receives, behind withOrganizationAccess.
  // Same resolution the switch-org route needed for the same reason.

  // These tenant paths are intentionally unauthenticated.
  // Webhooks authenticate via signed payloads (HMAC-SHA256, svix, ECDSA),
  // NOT by JWT, because external providers don't have access tokens.
  const isWebhook =
    pathname.startsWith('/api/v1/webhooks/') ||         // generic webhooks (WhatsApp Meta)
    pathname.startsWith('/api/v1/email/webhooks/') ||   // email provider callbacks (Resend, SendGrid)
    // QStash-triggered chunked SMS dispatch (closes SMS_MESSAGING_AUDIT_
    // 2026-08.md H3 — docs/messaging/UNIFIED_MESSAGING_ARCHITECTURE.md
    // Phase 3 item 10). Same "signed payload, no JWT"
    // shape as the webhooks above: Upstash signs every delivery with our
    // QStash signing keys (verified via Receiver in the route itself), not
    // a Bearer token. Scoped to this exact path, not the whole
    // /api/v1/workers/ tree — /api/v1/workers/cron keeps requiring a JWT
    // or WORKER_SECRET (see that route's own header comment) here.
    pathname === '/api/v1/workers/sms-dispatch-chunk' ||
    // Upstash Workflow disbursement watchdog (docs/messaging/
    // UNIFIED_MESSAGING_ARCHITECTURE.md §9, B2C_DISBURSEMENT_AUDIT.md C5).
    // Same signed-payload shape, but verified by serve() itself (from
    // @upstash/workflow) rather than a manual Receiver call in the route —
    // and unlike sms-dispatch-chunk, QStash re-POSTs this exact path once
    // per workflow step (not just once), so every one of those step
    // callbacks needs to clear this gate too, not just the initial trigger.
    pathname === '/api/v1/workers/disbursement-watchdog';

  // OPTIMIZATION_CLEANUP_AUDIT.md Critical #5 — this used to be a blanket
  // `pathname.startsWith('/api/v1/auth/')`, which also swept up
  // /auth/memberships and /auth/switch-group. Both call withAuth() and
  // require a verified access token's claims (stamped below), but the
  // blanket bypass skipped JWT verification for them entirely — every
  // request arrived with no x-user-id/x-group-id header, so withAuth
  // always threw "Missing authentication context" and the group-switcher
  // feature (components/layout/group-switcher.tsx) 401'd unconditionally
  // in production. Only list the routes that genuinely have no access
  // token yet (or use a different token type, like refresh's own).
  const PUBLIC_AUTH_PATHS = new Set([
    '/api/v1/auth/login',
    '/api/v1/auth/register',
    '/api/v1/auth/refresh',   // verifies its own refresh token from the body
    '/api/v1/auth/logout',    // ditto
    '/api/v1/auth/admin/login',
    '/api/v1/auth/admin/login/verify',
    // §4A email-link verification — the token itself is the proof of
    // possession (its SHA-256 hash alone identifies the open verification
    // row), so this must stay reachable without an access token: the click
    // may happen on a different device/browser than the one that registered.
    '/api/v1/auth/verify/email',
    // Multi-staff organizations, Phase 2 (migration 102) — the accept-invite
    // flow is a visitor with only an emailed link, no session yet. Same
    // token-is-the-proof shape as verify/email above.
    '/api/v1/organization-invitations/lookup',
    '/api/v1/organization-invitations/confirm-email',
    '/api/v1/organization-invitations/verify-otp',
    '/api/v1/organization-invitations/complete',
    '/api/v1/organization-invitations/decline',
    // Self-service forgot-password — a visitor who forgot their password has
    // no session by definition. Same OTP-is-the-proof shape as the flows above.
    '/api/v1/auth/forgot-password/start',
    '/api/v1/auth/forgot-password/reset',
    // Staff/backoffice forgot-password (ORGANIZATION_LOGIN_ARCHITECTURE_AUDIT.md
    // Phase 1) — same reasoning, email-link-is-the-proof instead of SMS OTP.
    '/api/v1/auth/admin/forgot-password/start',
    '/api/v1/auth/admin/forgot-password/reset',
  ]);

  if (
    isTenantApi && (
      PUBLIC_AUTH_PATHS.has(pathname) ||
      pathname.startsWith('/api/v1/jurisdictions/') || // public reference data (counties etc.)
      isMpesaCallback ||
      isWebhook
    )
  ) {
    return NextResponse.next({ request: { headers: sanitizedHeaders(req) } });
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
  // without re-verifying the JWT. Start from sanitized headers so only
  // proxy-stamped claims can ever reach a handler.
  const requestHeaders = sanitizedHeaders(req);
  requestHeaders.set('x-user-id', payload.sub);

  if (aud === 'tenant') {
    requestHeaders.set('x-aud', 'tenant');
    if (!payload.groupId || !payload.role) {
      return unauthorized('Incomplete tenant token payload');
    }
    requestHeaders.set('x-group-id', payload.groupId);
    requestHeaders.set('x-role',     payload.role);
    const groupStatus = payload.groupStatus ?? 'active';
    requestHeaders.set('x-group-status', groupStatus);
    if (payload.organizationId) requestHeaders.set('x-organization-id', payload.organizationId);
    // Active Membership Context (§2.1) + epochs (§2.5) — absent on legacy tokens.
    if (payload.membershipId)         requestHeaders.set('x-membership-id',   payload.membershipId);
    if (payload.membershipNo)         requestHeaders.set('x-membership-no',   payload.membershipNo);
    if (payload.authVersion != null)  requestHeaders.set('x-auth-version',    String(payload.authVersion));
    if (payload.sessionVersion != null) requestHeaders.set('x-session-version', String(payload.sessionVersion));
    // Comma-joined, not JSON: permission strings are always `[a-z_.]+` (never
    // contain commas), matching the existing plain-string header convention
    // above rather than paying JSON parse overhead per request.
    if (payload.permissions?.length) requestHeaders.set('x-permissions', payload.permissions.join(','));

    // Phase D Part 2 — gate feature routes while group is awaiting
    // verification. The verify endpoints + minimal session-management
    // endpoints stay open so the registrant can complete the flow.
    //
    // OPTIMIZATION_CLEANUP_AUDIT.md Critical #5 — this previously listed
    // '/api/v1/auth/me' and '/api/v1/auth/verify/', neither of which is a
    // real route (and refresh/logout are already caught by PUBLIC_AUTH_PATHS
    // above, so they never reach this check either) — meaning this allowlist
    // was entirely dead code and every pending_verification group was
    // permanently locked out with no way to ever complete verification.
    if (groupStatus === 'pending_verification') {
      const allowedPending =
        pathname === '/api/v1/auth/verify/start' ||
        pathname === '/api/v1/auth/verify/complete';
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
    requestHeaders.set('x-aud', aud);
    if (!payload.platformRole) {
      return unauthorized('Incomplete backoffice token payload');
    }
    requestHeaders.set('x-platform-role', payload.platformRole);
    if (payload.organizationId) requestHeaders.set('x-organization-id', payload.organizationId);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/api/:path*'],
};
