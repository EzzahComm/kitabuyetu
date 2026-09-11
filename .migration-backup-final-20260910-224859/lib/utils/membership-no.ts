/**
 * Membership Number utilities — fixed 8-character payment account numbers:
 *
 *   PP DDDDD C   e.g. BG102534  (displayed "BG 10253 4")
 *   PP    = groups.payment_prefix (2 letters, immutable branch code)
 *   DDDDD = 5-digit platform-wide sequence per prefix
 *   C     = Damm check digit over the full identifier
 *
 * The Damm quasigroup catches ALL single-character errors and ALL adjacent
 * transpositions — the two dominant human typo classes — so a mistyped
 * account number fails validation instead of paying a stranger in another
 * group (audit review W-1).
 *
 * Mirror implementation: supabase/migrations/…_056_membership_payment_accounts.sql
 * (damm_interim / damm_check_digit / damm_valid). KEEP THEM IDENTICAL — the
 * DB CHECK constraint and this module must agree on every input.
 */

const DAMM_TABLE: ReadonlyArray<ReadonlyArray<number>> = [
  [0, 3, 1, 7, 5, 9, 8, 6, 4, 2],
  [7, 0, 9, 2, 1, 5, 4, 8, 6, 3],
  [4, 2, 0, 6, 8, 7, 1, 3, 5, 9],
  [1, 7, 5, 0, 9, 8, 3, 4, 2, 6],
  [6, 1, 2, 3, 0, 4, 5, 9, 7, 8],
  [3, 6, 7, 4, 2, 0, 9, 5, 8, 1],
  [5, 8, 6, 9, 7, 2, 0, 1, 3, 4],
  [8, 9, 4, 5, 3, 6, 2, 0, 1, 7],
  [9, 4, 3, 8, 6, 1, 7, 2, 0, 5],
  [2, 5, 8, 1, 4, 3, 6, 7, 9, 0],
];

export const MEMBERSHIP_NO_RE = /^[A-Z]{2}[0-9]{6}$/;

function dammInterim(digits: string): number {
  let interim = 0;
  for (const ch of digits) {
    const d = ch.charCodeAt(0) - 48;
    if (d < 0 || d > 9) throw new Error(`dammInterim: non-digit input '${digits}'`);
    interim = DAMM_TABLE[interim][d];
  }
  return interim;
}

/** 'BG10253' → '1610253' — prefix letters mapped A=0…Z=25, each mod 10. */
function digitString(base: string): string {
  const a = (base.charCodeAt(0) - 65) % 10;
  const b = (base.charCodeAt(1) - 65) % 10;
  return `${a}${b}${base.slice(2)}`;
}

/** Check digit for a 7-char base (2 letters + 5 digits). */
export function dammCheckDigit(base: string): string {
  return String(dammInterim(digitString(base.toUpperCase())));
}

/** Strip spaces/dashes/underscores and uppercase — how members actually type. */
export function normalizeAccountRef(input: string): string {
  return input.trim().toUpperCase().replace(/[\s\-_./]+/g, '');
}

/** True when the (normalised) input has membership-number SHAPE (may still fail the check digit). */
export function looksLikeMembershipNo(input: string): boolean {
  return MEMBERSHIP_NO_RE.test(normalizeAccountRef(input));
}

/** Full validation: shape + Damm check digit. */
export function isValidMembershipNo(input: string): boolean {
  const n = normalizeAccountRef(input);
  if (!MEMBERSHIP_NO_RE.test(n)) return false;
  return dammInterim(digitString(n.slice(0, 7)) + n[7]) === 0;
}

/** Canonical display grouping: 'BG102534' → 'BG 10253 4'. */
export function formatMembershipNo(no: string): string {
  const n = normalizeAccountRef(no);
  if (!MEMBERSHIP_NO_RE.test(n)) return no;
  return `${n.slice(0, 2)} ${n.slice(2, 7)} ${n[7]}`;
}

/** Compose a full number from prefix + sequence (mirrors the DB allocator). */
export function composeMembershipNo(prefix: string, seq: number): string {
  if (!/^[A-Z]{2}$/.test(prefix)) throw new Error(`invalid prefix '${prefix}'`);
  if (!Number.isInteger(seq) || seq < 1 || seq > 99999) throw new Error(`sequence out of range: ${seq}`);
  const base = `${prefix}${String(seq).padStart(5, '0')}`;
  return base + dammCheckDigit(base);
}

// ─── Product suffix hints (allocation engine tiers A1/A3) ────────────────────

/** BG102534-L → loan repayment, -W → welfare, -S → shares. */
export type ProductSuffix = 'L' | 'W' | 'S';
const VALID_SUFFIXES: ReadonlySet<string> = new Set(['L', 'W', 'S']);

export interface ParsedAccountRef {
  /** The 8-char membership-number candidate (normalised), suffix removed. */
  account:       string;
  /** Valid product suffix, when present. */
  suffix:        ProductSuffix | null;
  /** True when a 9th trailing letter exists but isn't a known suffix (A1: reject, never guess). */
  invalidSuffix: boolean;
}

/**
 * Splits an inbound account reference into membership number + optional
 * product suffix. Members may type `BG102534-W`, `BG102534 W`, or
 * `BG102534W` — all normalise to a 9-char candidate whose first 8 chars have
 * membership-number shape.
 *
 * Anything that isn't membership-number shaped at all comes back as
 * `account = <normalised input>` with no suffix — the caller's registry
 * lookup / legacy grammar handles it.
 */
export function parseAccountRef(input: string | null | undefined): ParsedAccountRef {
  const n = normalizeAccountRef(input ?? '');
  if (n.length === 9 && MEMBERSHIP_NO_RE.test(n.slice(0, 8)) && /^[A-Z]$/.test(n[8])) {
    const suffix = n[8];
    if (VALID_SUFFIXES.has(suffix)) {
      return { account: n.slice(0, 8), suffix: suffix as ProductSuffix, invalidSuffix: false };
    }
    return { account: n.slice(0, 8), suffix: null, invalidSuffix: true };
  }
  return { account: n, suffix: null, invalidSuffix: false };
}
