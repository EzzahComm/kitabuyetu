/**
 * Circuit breaker for the SMS provider (SMS-AUDIT-v3 G15 / INV-39-adjacent).
 *
 * During an outage the queue did maximum work at maximum latency for
 * guaranteed-zero delivery: every failed send wrote an sms_failures row with a
 * flat 5-minute retry, retryFailures pulled them in batches with no notion of
 * provider health, and each attempt burned a 20-second timeout inside a
 * 60-second function ceiling. Recovery was slowest exactly when it mattered
 * most, and the wasted time starved every other job type through the shared
 * tick budget.
 *
 * ── Scope, stated honestly ──
 * This is per-instance, in-process state. Serverless means several instances
 * may each hold their own view, so it does NOT give a platform-wide "stop
 * everything" guarantee — that is what the operator kill switch is for
 * (messaging-billing.ts's SMS_DISPATCH_FLAG). What it does give is the thing
 * that actually hurts: one invocation grinding through dozens of 20-second
 * timeouts against a provider that is plainly down.
 *
 * Cross-instance visibility belongs to alerting, not to this — see the
 * provider-health signal recorded by the sms.service dispatch paths.
 */
import { logger } from '@/lib/logger';

/** Consecutive failures before the circuit opens. */
const FAILURE_THRESHOLD = 5;

/** How long the circuit stays open before a single probe is allowed through. */
const OPEN_DURATION_MS = 60_000;

type State = 'closed' | 'open' | 'half_open';

interface Circuit {
  state:            State;
  consecutiveFails: number;
  openedAt:         number | null;
}

const circuits = new Map<string, Circuit>();

function get(name: string): Circuit {
  let c = circuits.get(name);
  if (!c) {
    c = { state: 'closed', consecutiveFails: 0, openedAt: null };
    circuits.set(name, c);
  }
  return c;
}

/**
 * Whether a call may proceed.
 *
 * Transitions an expired open circuit to half-open and lets exactly that call
 * through as a probe — the result of which closes the circuit or re-opens it.
 */
export function canAttempt(name: string): boolean {
  const c = get(name);
  if (c.state === 'closed') return true;

  if (c.state === 'open' && c.openedAt !== null && Date.now() - c.openedAt >= OPEN_DURATION_MS) {
    c.state = 'half_open';
    logger.info('[sms-breaker] probing provider after cool-down', { provider: name });
    return true;
  }

  // Still open, or a probe is already in flight.
  return c.state === 'half_open' ? false : false;
}

export function recordSuccess(name: string): void {
  const c = get(name);
  if (c.state !== 'closed') {
    logger.info('[sms-breaker] provider recovered, circuit closed', {
      provider: name, afterFailures: c.consecutiveFails,
    });
  }
  c.state = 'closed';
  c.consecutiveFails = 0;
  c.openedAt = null;
}

export function recordFailure(name: string): void {
  const c = get(name);
  c.consecutiveFails += 1;

  // A failed probe re-opens immediately: one success is the only thing that
  // earns a closed circuit back.
  if (c.state === 'half_open' || c.consecutiveFails >= FAILURE_THRESHOLD) {
    if (c.state !== 'open') {
      logger.error('[sms-breaker] provider circuit OPEN — failing fast', {
        provider: name, consecutiveFails: c.consecutiveFails,
        reopenAfterMs: OPEN_DURATION_MS,
      });
    }
    c.state = 'open';
    c.openedAt = Date.now();
  }
}

/** Diagnostics for the health job and for tests. */
export function circuitState(name: string): Circuit {
  return { ...get(name) };
}

/** Tests only — the module holds process-lifetime state by design. */
export function resetCircuit(name?: string): void {
  if (name) circuits.delete(name);
  else circuits.clear();
}
