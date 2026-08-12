import type { NextRequest } from 'next/server';
import { withAdminDb } from '@/lib/db';
import { PaymentRequiredError } from '@/lib/utils/errors';
import type { AuthContext } from '@/types/api.types';

/**
 * Platform-wide paid-subscription gate.
 *
 * Every plan is paid (migration 138 / PLAN_MONTHLY_FEES), so a group with no
 * active subscription is locked out of the product until it pays. Before this,
 * the only enforcement anywhere was `assertFeatureAccess` on the two import
 * routes plus reserve_sms_credits' own check — so an unpaid group kept full
 * access to contributions, loans, accounting and reports, and "no free plan"
 * meant nothing in practice.
 *
 * THE CARVE-OUTS ARE THE LOAD-BEARING PART. A lock that also blocks paying is
 * just an outage: a locked group must still be able to sign in, see what it
 * owes, get an STK prompt or the PayBill details, and have the resulting
 * payment activate its plan. Everything in OPEN_PREFIXES is required for that
 * loop to close — do not trim this list without walking the pay-from-locked
 * path end to end.
 */
const OPEN_PREFIXES: readonly string[] = [
  // Sign in, refresh a token, switch group, sign out. Without this a locked
  // user cannot reach the app at all.
  '/api/v1/auth/',
  // See the plans and their prices, and claim a completed payment.
  '/api/v1/billing/',
  // Send the STK prompt, poll its status, and receive Safaricom's callback —
  // the actual act of paying.
  '/api/v1/mpesa/',
  // The dashboard shell reads the current user to render anything at all,
  // including the billing page it redirects a locked group to.
  '/api/v1/me',
  // Liveness/readiness must never depend on a tenant's billing state.
  '/api/v1/health',
  // Cron, queue workers and provider webhooks run with no interactive user;
  // gating them would silently stop billing itself from working.
  '/api/v1/workers/',
  '/api/v1/webhooks/',
  '/api/v1/daraja/',
  // Organization/backoffice axis is a platform role, not a group subscription.
  '/api/v1/organization',
];

/** Roles that are never subject to a tenant's billing state. */
const EXEMPT_ROLES: readonly string[] = ['super_admin', 'support'];

const CACHE_TTL_MS = 60_000;

/**
 * In-process, deliberately NOT Redis.
 *
 * This runs on every authenticated request, so anything here is on the hot
 * path for the entire tenant API. A Redis round trip was the first attempt and
 * was wrong twice over: it added a network hop per request, and when Upstash
 * is unreachable the client retries with backoff, so an outage would slow down
 * every request in the product rather than just the features that cache. CI
 * proved the point immediately — it points REDIS_URL at a nonexistent host,
 * and every authenticated test blew its 5s budget on retries.
 *
 * A per-group boolean needs no sharing between instances, so a Map is a better
 * fit than a shared cache anyway: each instance independently re-checks at
 * most once a minute per group.
 */
const activeUntil = new Map<string, number>();

/**
 * Bounded so a long-lived instance serving many groups cannot grow this
 * without limit. Entries are worthless once expired, so a full sweep on
 * overflow is both cheap and sufficient.
 */
const MAX_CACHE_ENTRIES = 10_000;

function rememberActive(groupId: string): void {
  if (activeUntil.size >= MAX_CACHE_ENTRIES) {
    const now = Date.now();
    for (const [key, expiry] of activeUntil) {
      if (expiry <= now) activeUntil.delete(key);
    }
    // Still full — every entry is live. Drop the oldest insertion (Map
    // preserves insertion order) rather than refuse to cache anything.
    if (activeUntil.size >= MAX_CACHE_ENTRIES) {
      const oldest = activeUntil.keys().next();
      if (!oldest.done) activeUntil.delete(oldest.value);
    }
  }
  activeUntil.set(groupId, Date.now() + CACHE_TTL_MS);
}

/** Test-only: drop cached entitlements so a suite can flip state mid-test. */
export function __resetSubscriptionCache(): void {
  activeUntil.clear();
}

/**
 * Throws PaymentRequiredError (402) when this group holds no active
 * subscription and the route is not part of the pay-from-locked path.
 *
 * Only the POSITIVE result is cached. A locked group re-reads the database on
 * every request, which costs a query on a path that is by definition rare, and
 * buys the property that matters far more: the moment a payment activates a
 * plan, the group is unlocked — rather than staying locked for up to a minute
 * after paying, which reads as "I paid and it's still broken".
 *
 * Does NOT fail open on a database error: that path throws, and a request that
 * cannot establish entitlement must not be served as though it had one.
 */
export async function assertSubscriptionActive(
  req:  NextRequest,
  auth: AuthContext,
): Promise<void> {
  const path = req.nextUrl.pathname;
  if (OPEN_PREFIXES.some((prefix) => path.startsWith(prefix))) return;
  if (EXEMPT_ROLES.includes(auth.role)) return;

  const cached = activeUntil.get(auth.groupId);
  if (cached !== undefined) {
    if (cached > Date.now()) return;
    activeUntil.delete(auth.groupId);
  }

  const active = await withAdminDb(async (db) => {
    const { rows } = await db.query(
      `SELECT 1 FROM subscriptions
       WHERE group_id = $1 AND status IN ('active', 'trial')
       LIMIT 1`,
      [auth.groupId],
    );
    return rows.length > 0;
  });

  if (!active) {
    throw new PaymentRequiredError(
      'This group has no active subscription. Choose a plan and pay to restore access.',
    );
  }

  rememberActive(auth.groupId);
}
