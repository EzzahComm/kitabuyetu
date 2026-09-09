/**
 * Product allocation engine — the pure decision core of payment architecture
 * §3.5 (decision table A1–A9). Deterministic: same input → same outcome,
 * never a guess.
 *
 *   A1  Invalid suffix                → handled by the caller (reject/unrouted)
 *   A2  Open request, EXACT amount    → that request (oldest exact match)
 *   A3  Valid suffix                  → suffix product (never overrides A2)
 *   A4  Exactly one open request      → that request (variance tagged)
 *   A5  Multiple open, no exact match → OLDEST request (variance tagged)
 *   A6  Expired requests              → filtered out by the caller's query
 *   A7  Member default product        → membership preference
 *   A8  Group default product         → group configuration (default savings)
 *   A9  No handler for the product    → caller parks unrouted (config error)
 *
 * This module is intentionally I/O-free so the table is unit-testable —
 * the caller supplies open requests (already expiry-filtered) and defaults.
 */

export type PaymentProduct =
  | 'savings' | 'loan_repayment' | 'welfare' | 'share'
  | 'investment' | 'fine' | 'registration' | 'subscription';

export interface OpenPaymentRequest {
  id:        string;
  product:   PaymentProduct;
  entityId:  string | null;
  amount:    number;
  createdAt: Date;
}

export interface ResolveProductInput {
  /** Valid product suffix from the account reference, if any (A3). */
  suffix:        'L' | 'W' | 'S' | null;
  /** OPEN, UNEXPIRED requests for this membership (A6 filtering is the caller's). */
  openRequests:  OpenPaymentRequest[];
  /** Membership-level default (A7). */
  memberDefault: PaymentProduct | null;
  /** Group-level default (A8). */
  groupDefault:  PaymentProduct;
  /** Paid amount, for exact-match (A2) and variance tagging. */
  amount:        number;
}

export interface ResolvedProduct {
  product:        PaymentProduct;
  /** The request this payment fulfils, when one drove the decision. */
  requestId:      string | null;
  entityId:       string | null;
  /** True when a request drove the decision but the amount differs (§3.5). */
  amountVariance: boolean;
  /** Which tier decided — for payment_events detail / debugging. */
  tier:           'A2' | 'A3' | 'A4' | 'A5' | 'A7' | 'A8';
}

const SUFFIX_PRODUCT: Record<'L' | 'W' | 'S', PaymentProduct> = {
  L: 'loan_repayment',
  W: 'welfare',
  S: 'share',
};

const AMOUNT_EPSILON = 0.005; // NUMERIC(15,2) equality

function byAge(a: OpenPaymentRequest, b: OpenPaymentRequest): number {
  return a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
}

export function resolveProduct(input: ResolveProductInput): ResolvedProduct {
  const open = [...input.openRequests].sort(byAge);

  // A2 — exact-amount request match beats everything, including suffixes.
  const exact = open.find((r) => Math.abs(r.amount - input.amount) < AMOUNT_EPSILON);
  if (exact) {
    return { product: exact.product, requestId: exact.id, entityId: exact.entityId,
             amountVariance: false, tier: 'A2' };
  }

  // A3 — explicit suffix.
  if (input.suffix) {
    return { product: SUFFIX_PRODUCT[input.suffix], requestId: null, entityId: null,
             amountVariance: false, tier: 'A3' };
  }

  // A4 / A5 — request-driven with amount variance (single, or oldest of many).
  if (open.length >= 1) {
    const chosen = open[0];
    return { product: chosen.product, requestId: chosen.id, entityId: chosen.entityId,
             amountVariance: true, tier: open.length === 1 ? 'A4' : 'A5' };
  }

  // A7 — membership default.
  if (input.memberDefault) {
    return { product: input.memberDefault, requestId: null, entityId: null,
             amountVariance: false, tier: 'A7' };
  }

  // A8 — group default.
  return { product: input.groupDefault, requestId: null, entityId: null,
           amountVariance: false, tier: 'A8' };
}
