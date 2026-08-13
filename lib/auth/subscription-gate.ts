import type { NextRequest } from 'next/server';
import { withAdminDb } from '@/lib/db';
import { PaymentRequiredError, ProductNotEntitledError } from '@/lib/utils/errors';
import type { AuthContext } from '@/types/api.types';
import type { SubscriptionProduct } from '@/types/enums';

/**
 * Platform-wide paid-subscription gate, scoped per product.
 *
 * Every plan is paid (migration 138 / PLAN_MONTHLY_FEES), so a group with no
 * active subscription is locked out of the product until it pays. Before this,
 * the only enforcement anywhere was `assertFeatureAccess` on the two import
 * routes plus reserve_sms_credits' own check — so an unpaid group kept full
 * access to contributions, loans, accounting and reports, and "no free plan"
 * meant nothing in practice.
 *
 * Migration 140 added a SECOND axis. A Chama Reminder group is a
 * communication-only product: register_group() gives it no chart of accounts,
 * so it has nothing to post journals against. Asking only "is this group paying
 * for anything" would let it straight into /api/v1/loans and /api/v1/accounting
 * and fail deep inside a posting template. The alternative — auditing every
 * downstream code path that assumes a general ledger exists — is unbounded, so
 * the check happens once, here, where every tenant route already passes.
 *
 * THE CARVE-OUTS ARE THE LOAD-BEARING PART. A lock that also blocks paying is
 * just an outage: a locked group must still be able to sign in, see what it
 * owes, get an STK prompt or the PayBill details, and have the resulting
 * payment activate its plan. Everything marked 'open' is required for that loop
 * to close — do not trim those without walking the pay-from-locked path end to
 * end.
 */

/**
 * What a route requires.
 *   'open'  — reachable with no subscription at all (the pay-from-locked path).
 *   'any'   — any active product. The shared surface both products use.
 *   product — that specific product must be active.
 */
export type RouteEntitlement = 'open' | 'any' | SubscriptionProduct;

/**
 * Anything not listed requires Kitabu Yetu. The default is deliberately the
 * CLOSED one, because the two failure modes are not symmetrical:
 *
 *   - A new Kitabu Yetu route added later with no entry here is correct with
 *     zero action. That is the overwhelmingly common case.
 *   - A new SHARED route added later with no entry 402s for Chama Reminder
 *     groups — loud, immediate, and found the first time the reminder portal
 *     opens it. One line to fix.
 *
 * The reverse default fails silently and dangerously: a group with no chart of
 * accounts quietly reaching /api/v1/dividends.
 */
export const DEFAULT_ENTITLEMENT: RouteEntitlement = 'kitabu_yetu';

/** Exported so the drift test can assert against the real policy. */
export const ENTITLEMENT_RULES: ReadonlyArray<readonly [string, RouteEntitlement]> = [
  // ── open: the pay-from-locked path ──────────────────────────────────────
  // Sign in, refresh a token, switch group, sign out. Without this a locked
  // user cannot reach the app at all.
  ['/api/v1/auth', 'open'],
  // See the plans and their prices, read entitlements, claim a completed
  // payment. A group with ZERO subscriptions has to reach this to render its
  // own subscribe page, which is why /billing/entitlements lives here too.
  ['/api/v1/billing', 'open'],
  // Send the STK prompt, poll its status, and receive Safaricom's callback —
  // the actual act of paying.
  ['/api/v1/mpesa', 'open'],
  // The member's own self-service surface (goals, notifications, passbook,
  // wallet). Note there is no route at /api/v1/me itself.
  ['/api/v1/me', 'open'],
  // Cron, queue workers and provider webhooks run with no interactive user;
  // gating them would silently stop billing itself from working.
  ['/api/v1/workers', 'open'],
  ['/api/v1/webhooks', 'open'],
  ['/api/v1/daraja', 'open'],
  // Organization/backoffice axis is a platform role, not a group subscription.
  ['/api/v1/organization', 'open'],

  // ── any active product: the shared surface ──────────────────────────────
  // This IS the Chama Reminder product surface. Both entries are shared rather
  // than chama_reminder-scoped on purpose: a Kitabu Yetu group must keep its
  // member list and SMS Centre, and birthday SMS has been a platform-wide job
  // since Phase 1, so its views belong to both products.
  ['/api/v1/members', 'any'],
  ['/api/v1/sms', 'any'],
];

/** Roles that are never subject to a tenant's billing state. */
const EXEMPT_ROLES: readonly string[] = ['super_admin', 'support'];

const CACHE_TTL_MS = 60_000;

/**
 * Segment-aware prefix match. `startsWith` alone is wrong here and was wrong in
 * production: '/api/v1/me' matched BOTH '/api/v1/members' and '/api/v1/meetings'
 * by raw string prefix, so migration 139's lock never covered either of them —
 * an unpaid group kept full access to the member list and to member creation.
 *
 * A prefix must match a whole path segment: exactly the prefix, or the prefix
 * followed by '/'.
 */
function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + '/');
}

/**
 * Resolve what a path requires. LONGEST match wins, not first match, so list
 * order in ENTITLEMENT_RULES is never load-bearing and a later entry cannot be
 * silently shadowed by an earlier, shorter one.
 */
export function requiredEntitlement(path: string): RouteEntitlement {
  let best = DEFAULT_ENTITLEMENT;
  let bestLen = -1;
  for (const [prefix, requirement] of ENTITLEMENT_RULES) {
    if (matchesPrefix(path, prefix) && prefix.length > bestLen) {
      best = requirement;
      bestLen = prefix.length;
    }
  }
  return best;
}

interface CacheEntry {
  products:  ReadonlySet<SubscriptionProduct>;
  expiresAt: number;
}

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
 * A per-group product set needs no sharing between instances, so a Map is a
 * better fit than a shared cache anyway: each instance independently re-checks
 * at most once a minute per group.
 */
const entitlements = new Map<string, CacheEntry>();

/**
 * Bounded so a long-lived instance serving many groups cannot grow this
 * without limit. Entries are worthless once expired, so a full sweep on
 * overflow is both cheap and sufficient.
 */
const MAX_CACHE_ENTRIES = 10_000;

function remember(groupId: string, products: ReadonlySet<SubscriptionProduct>): void {
  if (entitlements.size >= MAX_CACHE_ENTRIES) {
    const now = Date.now();
    for (const [key, entry] of entitlements) {
      if (entry.expiresAt <= now) entitlements.delete(key);
    }
    // Still full — every entry is live. Drop the oldest insertion (Map
    // preserves insertion order) rather than refuse to cache anything.
    if (entitlements.size >= MAX_CACHE_ENTRIES) {
      const oldest = entitlements.keys().next();
      if (!oldest.done) entitlements.delete(oldest.value);
    }
  }
  entitlements.set(groupId, { products, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Test-only: drop cached entitlements so a suite can flip state mid-test. */
export function __resetSubscriptionCache(): void {
  entitlements.clear();
}

async function loadActiveProducts(groupId: string): Promise<Set<SubscriptionProduct>> {
  return withAdminDb(async (db) => {
    const { rows } = await db.query<{ product: SubscriptionProduct }>(
      `SELECT DISTINCT product FROM subscriptions
       WHERE group_id = $1 AND status IN ('active', 'trial')`,
      [groupId],
    );
    return new Set(rows.map((r) => r.product));
  });
}

/**
 * Throws when this group cannot reach this route:
 *   402 PAYMENT_REQUIRED     — holds no active subscription at all.
 *   402 PRODUCT_NOT_ENTITLED — is paying, but not for this product.
 *
 * Both are 402 because both are entitlement/payment conditions with the same
 * remedy (pay). They carry different codes so the client can send a Kitabu
 * Yetu user to /billing and a Chama Reminder user to their own subscribe page.
 * 403 would be wrong: it collides with requirePermission's ForbiddenError and
 * would read as an RBAC bug in triage.
 *
 * THE CACHE IS AN ALLOW-LIST: a cached entry may only ever GRANT. Any decision
 * that would DENY re-reads the database first. That generalises the old
 * positives-only rule, and it is not optional — caching a product SET naively
 * would re-break the exact case the old rule protected: a group holding
 * kitabu_yetu that buys chama_reminder would have a stale {kitabu_yetu} cached
 * for up to a minute, so the portal it just paid for would 402. "I paid and
 * it's still broken", one product later.
 *
 * The cost is that a group hitting a route it is NOT entitled to re-queries
 * every request. That is the same profile as the old locked-group path, which
 * this file already accepts as a query on a path that is by definition rare.
 *
 * Does NOT fail open on a database error: that path throws, and a request that
 * cannot establish entitlement must not be served as though it had one.
 *
 * This cannot move to proxy.ts — that runs on the edge runtime with no `pg` —
 * which is why it hangs off withAuth instead.
 */
export async function assertSubscriptionActive(
  req:  NextRequest,
  auth: AuthContext,
): Promise<void> {
  const required = requiredEntitlement(req.nextUrl.pathname);
  if (required === 'open') return;
  if (EXEMPT_ROLES.includes(auth.role)) return;

  const satisfies = (products: ReadonlySet<SubscriptionProduct>): boolean =>
    products.size > 0 && (required === 'any' || products.has(required));

  const cached = entitlements.get(auth.groupId);
  if (cached && cached.expiresAt > Date.now() && satisfies(cached.products)) return;

  // Nothing cached, expired, or cached but insufficient for THIS route.
  // Never deny on cached state — re-read.
  const products = await loadActiveProducts(auth.groupId);
  if (products.size > 0) remember(auth.groupId, products);

  if (products.size === 0) {
    throw new PaymentRequiredError(
      'This group has no active subscription. Choose a plan and pay to restore access.',
    );
  }
  if (!satisfies(products)) {
    throw new ProductNotEntitledError(required as SubscriptionProduct);
  }
}
