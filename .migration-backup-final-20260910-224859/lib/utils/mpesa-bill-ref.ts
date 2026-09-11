/**
 * Parses Safaricom M-Pesa BillRefNumber strings into routing decisions.
 *
 * Members enter these on the M-Pesa app's "Account Number" field after
 * picking the PayBill 500020109900. The platform recognises:
 *
 *   KYT-CONTR-<group_code>[-<member_code>]   → contribution
 *   KYT-LOAN-<loan_id_or_prefix>              → loan repayment
 *   KYT-WELF-<group_code>                     → welfare pool
 *   KYT-INV-<investment_id_or_prefix>         → investment subscription
 *   KYT-SUB-<group_code>                      → SaaS subscription invoice
 *   KYT-SHARE-<group_code>[-<member_code>]    → share purchase
 *   INV-YYYY-NNNNNN                           → direct invoice payment
 *
 * The parser is intentionally permissive: Safaricom uppercases the field on
 * transmission, members type with inconsistent separators (- _ space), and
 * some POS apps strip dashes entirely. We normalise on parse and only fall
 * through to `kind=unknown` when no prefix matches.
 *
 * Returns a pure RoutingDecision object — no DB calls, no I/O. The handler
 * decides what to do with it (look up the group, fall through to unrouted,
 * etc.).
 */

export type BillRefKind =
  | 'contribution'
  | 'loan_repayment'
  | 'welfare'
  | 'investment'
  | 'subscription'
  | 'share'
  | 'invoice'
  | 'unknown';

export interface RoutingDecision {
  kind:        BillRefKind;
  /** Normalised, uppercased, dash-delimited form. Useful for logging. */
  normalised:  string;
  /** Group code (`KY1234567`) when the prefix encodes one. */
  groupCode:   string | null;
  /** Member code suffix (`MEM12345` or `KY12345`) when the prefix encodes one. */
  memberCode:  string | null;
  /** Loan / investment / share UUID or short-id suffix. */
  entityId:    string | null;
  /** Invoice number for `INV-YYYY-NNNNNN`. */
  invoiceNumber: string | null;
  /** The raw input as received. */
  raw:         string;
}

const KNOWN_PREFIXES: Record<string, BillRefKind> = {
  CONTR: 'contribution',
  LOAN:  'loan_repayment',
  WELF:  'welfare',
  INV:   'investment',
  SUB:   'subscription',
  SHARE: 'share',
};

/**
 * Canonical group-code shape (per migration 030): `KY` + 7 digits.
 * Used to disambiguate a token as a group code vs. a member/loan id.
 */
const GROUP_CODE_RE  = /^KY[0-9]{7}$/;
const INVOICE_RE     = /^INV-\d{4}-\d{4,8}$/;
const UUID_RE        = /^[0-9A-F]{8}-?[0-9A-F]{4}-?[0-9A-F]{4}-?[0-9A-F]{4}-?[0-9A-F]{12}$/;

export function parseBillRefNumber(input: string | null | undefined): RoutingDecision {
  const raw = (input ?? '').toString();
  const normalised = normalise(raw);

  // Invoice number: INV-YYYY-NNNNNN. Highest priority — distinct format.
  if (INVOICE_RE.test(normalised)) {
    return decision('invoice', { normalised, raw, invoiceNumber: normalised });
  }

  // Everything else is platform-prefixed. Strip leading KYT- and split.
  // We tolerate KYT, KY (legacy), or no prefix as long as the second token
  // is a recognised category.
  const tokens = normalised.split('-').filter(Boolean);
  if (tokens.length === 0) {
    return decision('unknown', { normalised, raw });
  }

  // Strip the optional platform prefix (KYT or KY when followed by a category)
  let cursor = 0;
  if ((tokens[0] === 'KYT' || tokens[0] === 'KY') && tokens.length > 1 && tokens[1] in KNOWN_PREFIXES) {
    cursor = 1;
  }

  const categoryToken = tokens[cursor];
  const kind = KNOWN_PREFIXES[categoryToken];
  if (!kind) {
    return decision('unknown', { normalised, raw });
  }
  cursor++;

  const remaining = tokens.slice(cursor);
  if (remaining.length === 0) {
    return decision(kind, { normalised, raw });
  }

  // Categories that target a specific entity (loan/investment id). Members
  // typically type the full UUID, which gets split on dashes by normalise().
  // Rejoin every remaining token so the entityId preserves the original
  // identifier (UUID or short-id alike).
  if (kind === 'loan_repayment' || kind === 'investment') {
    return decision(kind, {
      normalised,
      raw,
      entityId: remaining.join('-'),
    });
  }

  const [first, second] = remaining;

  // Group-scoped categories
  if (GROUP_CODE_RE.test(first)) {
    return decision(kind, {
      normalised,
      raw,
      groupCode: first,
      memberCode: second ?? null,
    });
  }

  // First token didn't look like a group code — pass it through as entity id
  // for the handler to attempt a soft match.
  return decision(kind, {
    normalised,
    raw,
    entityId: first ?? null,
    memberCode: second ?? null,
  });
}

/**
 * Lightweight predicate — true when the input *looks like* a Daraja test/sandbox
 * test ref. Used by the handler to skip noisy unrouted-queue inserts during
 * sandbox testing. We don't bypass routing entirely, just suppress unrouted
 * inserts for known-junk values.
 */
export function isSandboxTestRef(input: string | null | undefined): boolean {
  const n = normalise(input ?? '');
  return n === 'TEST' || n === 'ACCOUNT' || n === '' || /^TEST[-_]?\d+$/.test(n);
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function normalise(s: string): string {
  return s
    .trim()
    .toUpperCase()
    // Common separators a member might enter
    .replace(/[\s_/.]+/g, '-')
    // Collapse runs of dashes
    .replace(/-{2,}/g, '-')
    // Strip leading/trailing dashes left by the collapse
    .replace(/^-+|-+$/g, '');
}

function decision(
  kind: BillRefKind,
  parts: Partial<Omit<RoutingDecision, 'kind'>> & { normalised: string; raw: string },
): RoutingDecision {
  return {
    kind,
    normalised:    parts.normalised,
    raw:           parts.raw,
    groupCode:     parts.groupCode     ?? null,
    memberCode:    parts.memberCode    ?? null,
    entityId:      parts.entityId      ?? null,
    invoiceNumber: parts.invoiceNumber ?? null,
  };
}

// Re-export for callers that want to validate UUID/short-id suffixes
// before issuing DB lookups.
export const __testables__ = { GROUP_CODE_RE, INVOICE_RE, UUID_RE, normalise };
