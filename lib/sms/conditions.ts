/**
 * Condition DSL for SMS trigger rules.
 *
 * Rules are authored by group and organization administrators and stored as
 * JSONB, so evaluation must never reach for `eval`, `Function`, or a template
 * engine that can run code. This is a closed, data-only grammar:
 *
 *   { all: [ ...Condition ] }          — every child must match
 *   { any: [ ...Condition ] }          — at least one child must match
 *   { not: Condition }                 — negation
 *   { field, op, value }               — leaf comparison against the payload
 *   {}                                 — always matches
 *
 * Amounts arrive from Postgres NUMERIC as strings ('500.00'), so comparisons
 * coerce both sides to numbers when both are unambiguously numeric. That makes
 * `{field:'amount', op:'gte', value:1000}` behave as an author expects against
 * a payload carrying `amount: '1000.00'`.
 */

import type { EventPayload } from './events';

export type ConditionOp =
  | 'eq' | 'neq'
  | 'gt' | 'gte' | 'lt' | 'lte'
  | 'in' | 'nin'
  | 'contains'
  | 'exists';

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { field: string; op: ConditionOp; value?: unknown }
  | Record<string, never>;

/** Guards against a hand-edited or hostile rule row exhausting the stack. */
const MAX_DEPTH = 10;
const MAX_NODES = 200;

/**
 * True when `payload` satisfies `condition`.
 *
 * Malformed conditions evaluate to `false` rather than throwing: a rule with a
 * corrupt condition must not take down the business transaction that emitted
 * the event. The caller logs the mismatch.
 */
export function evaluateCondition(condition: unknown, payload: EventPayload): boolean {
  let budget = MAX_NODES;

  function walk(node: unknown, depth: number): boolean {
    if (depth > MAX_DEPTH || --budget < 0) return false;
    if (!node || typeof node !== 'object' || Array.isArray(node)) return false;

    const n = node as Record<string, unknown>;

    // `{}` — unconditional match. Keeps `conditions DEFAULT '{}'` meaningful.
    if (Object.keys(n).length === 0) return true;

    if (Array.isArray(n.all)) return n.all.every((c) => walk(c, depth + 1));
    if (Array.isArray(n.any)) return n.any.some((c) => walk(c, depth + 1));
    if ('not' in n)           return !walk(n.not, depth + 1);

    if (typeof n.field === 'string' && typeof n.op === 'string') {
      return compare(payload[n.field], n.op as ConditionOp, n.value);
    }

    return false;
  }

  return walk(condition, 0);
}

function compare(actual: unknown, op: ConditionOp, expected: unknown): boolean {
  // `exists` is the only op that is meaningful on an absent value.
  if (op === 'exists') {
    const present = actual !== undefined && actual !== null && actual !== '';
    return expected === false ? !present : present;
  }
  if (actual === undefined || actual === null) return false;

  switch (op) {
    case 'eq':  return looseEquals(actual, expected);
    case 'neq': return !looseEquals(actual, expected);

    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const a = toNumber(actual);
      const b = toNumber(expected);
      if (a === null || b === null) return false;
      if (op === 'gt')  return a >  b;
      if (op === 'gte') return a >= b;
      if (op === 'lt')  return a <  b;
      return a <= b;
    }

    case 'in':
      return Array.isArray(expected) && expected.some((e) => looseEquals(actual, e));
    case 'nin':
      return Array.isArray(expected) && !expected.some((e) => looseEquals(actual, e));

    case 'contains':
      return typeof expected === 'string'
        && String(actual).toLowerCase().includes(expected.toLowerCase());

    default:
      return false;
  }
}

/**
 * Numeric when both sides are unambiguously numeric, string-wise otherwise.
 * '500.00' equals 500; 'KES' never equals 0 (which a bare Number() coercion
 * would allow via NaN-free empty-string handling).
 */
function looseEquals(a: unknown, b: unknown): boolean {
  const na = toNumber(a);
  const nb = toNumber(b);
  if (na !== null && nb !== null) return na === nb;
  if (typeof a === 'boolean' || typeof b === 'boolean') return a === b;
  return String(a) === String(b);
}

/** Strict numeric coercion — rejects '', whitespace, booleans, null, NaN. */
function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
