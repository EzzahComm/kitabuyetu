/**
 * Splits a contribution amount across multiple ledger accounts per
 * group-configured rules. Pure function — no DB, no I/O.
 *
 * Algorithm (per the locked plan decision):
 *   1. Fixed-amount lines are applied first in priority order (ascending).
 *      Partial allocation is allowed if the contribution doesn't cover the
 *      full fixed amount.
 *   2. Remaining amount is distributed across percentage lines using the
 *      **largest-remainder** rounding method, so the sum is always exactly
 *      the input amount (no penny drift).
 *   3. Any leftover (e.g. percentages summing to < 100) goes to the default
 *      account.
 *   4. Empty rule set → 100% to the default account (matches the "no
 *      configuration = legacy behaviour" decision).
 *
 * Internal math runs in integer cents to avoid float drift. Inputs and
 * outputs are decimal KES (NUMERIC(15,2) compatible).
 */

export interface SplitRule {
  account_code: string;
  /** 0 < percentage <= 100 — exclusive with `fixed_amount`. */
  percentage:   number | null;
  /** > 0 in KES — exclusive with `percentage`. */
  fixed_amount: number | null;
  /** Lower priority applied first (ascending). Defaults to 100. */
  priority:     number;
}

export interface Allocation {
  account_code:  string;
  /** Allocation in KES, rounded to 2dp (NUMERIC(15,2) compatible). */
  amount:        number;
  /** Same value in cents — useful for journal posting without re-rounding. */
  amount_cents:  number;
}

/**
 * Splits `amountKes` across `rules`. Unallocated remainder falls to
 * `defaultAccountCode` (typically the group's member-savings income code,
 * e.g. '4001').
 */
export function allocateSplit(
  amountKes:          number,
  rules:              readonly SplitRule[],
  defaultAccountCode: string,
): Allocation[] {
  if (amountKes <= 0) return [];

  const totalCents = Math.round(amountKes * 100);
  const lines     = new Map<string, number>();

  // No rules → everything to the default account.
  if (rules.length === 0) {
    lines.set(defaultAccountCode, totalCents);
    return finalise(lines);
  }

  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  const fixed  = sorted.filter((r) => r.fixed_amount != null);
  const pct    = sorted.filter((r) => r.percentage   != null);

  let remainder = totalCents;

  // 1. Fixed-amount lines (priority order). Partial allocation when
  //    contribution is smaller than the requested fixed amount.
  for (const r of fixed) {
    if (remainder <= 0) break;
    const wantCents  = Math.round((r.fixed_amount ?? 0) * 100);
    const allocCents = Math.min(wantCents, remainder);
    addLine(lines, r.account_code, allocCents);
    remainder -= allocCents;
  }

  // 2. Percentage lines via largest-remainder.
  //
  // Two distinct "leftover" concepts to keep separate:
  //   • Rounding gap  — sum(ideals) - sum(floors). At most pct.length cents.
  //                     Distributed WITHIN the pct group by largest remainder.
  //   • Uncovered     — remainder - sum(ideals). Non-zero when totalPct < 100.
  //                     Falls through to the default account in step 3.
  if (pct.length > 0 && remainder > 0) {
    const totalPct = pct.reduce((sum, r) => sum + (r.percentage ?? 0), 0);
    if (totalPct > 0) {
      // If percentages sum to >100 (validator should prevent), scale down
      // so we never over-allocate.
      const scale = totalPct > 100 ? 100 / totalPct : 1;
      const effectivePctFraction = pct.map((r) => (r.percentage! * scale) / 100);

      const ideals    = effectivePctFraction.map((f) => f * remainder);
      const floors    = ideals.map((i) => Math.floor(i));
      const fracts    = ideals.map((i, idx) => i - floors[idx]);
      const sumIdeals = ideals.reduce((a, b) => a + b, 0);
      const sumFloors = floors.reduce((a, b) => a + b, 0);

      // Apply the integer floors.
      pct.forEach((r, i) => addLine(lines, r.account_code, floors[i]));

      // Distribute the rounding gap (NOT the uncovered portion) by
      // largest fractional remainder. Ties broken by priority (lower first).
      let roundingGap = Math.round(sumIdeals) - sumFloors;
      const order = pct
        .map((r, i) => ({ idx: i, code: r.account_code, frac: fracts[i], priority: r.priority }))
        .sort((a, b) => b.frac - a.frac || a.priority - b.priority);
      for (const o of order) {
        if (roundingGap <= 0) break;
        addLine(lines, o.code, 1);
        roundingGap--;
      }

      // Reduce the running remainder by what the pct group actually consumed.
      // Whatever's left is uncovered (totalPct < 100 case) and falls to default.
      remainder -= Math.round(sumIdeals);
    }
  }

  // 3. Anything still unallocated → default account.
  if (remainder > 0) {
    addLine(lines, defaultAccountCode, remainder);
  }

  return finalise(lines);
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function addLine(lines: Map<string, number>, code: string, cents: number): void {
  if (cents <= 0) return;
  lines.set(code, (lines.get(code) ?? 0) + cents);
}

function finalise(lines: Map<string, number>): Allocation[] {
  return Array.from(lines.entries()).map(([code, cents]) => ({
    account_code: code,
    amount_cents: cents,
    amount:       cents / 100,
  }));
}
