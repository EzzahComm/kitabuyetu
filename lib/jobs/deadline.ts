/**
 * The current job tick's wall-clock deadline.
 *
 * Deliberately a standalone module with NO imports. The processor sets it and
 * the long-running services read it; if either side imported the other the
 * cycle would be processor -> handlers -> services -> processor.
 *
 * ── Why this exists ──
 * app/api/cron/route.ts pins `maxDuration = 60`, which on Vercel's **Hobby**
 * plan is the hard platform ceiling, not a choice — it cannot be raised.
 * processJobBatch's own TIME_BUDGET_MS is 50s, so once a job is claimed there
 * are ~10s before the platform kills the invocation mid-write.
 *
 * That is fine for short jobs and false for at least three SMS ones, which are
 * unbounded loops over outbound HTTP with per-call timeouts individually
 * larger than the whole remaining margin (pollPendingDlrs: up to 15 calls at a
 * 15s timeout; retryFailures: up to 100 sends at 20s). A kill mid-loop leaves
 * the job in 'processing' until resetStuckJobs reclaims it, and for send paths
 * it can mean a message delivered but never recorded — then delivered AGAIN on
 * the retry.
 *
 * The batch budget alone cannot fix that, because it is only consulted BEFORE
 * a job is claimed. So the loops have to bound themselves, which is what this
 * gives them: partial progress is safe for both (they are idempotent sweeps
 * that simply resume next tick), whereas being killed is not.
 */

let deadlineAt: number | null = null;

/** Called by processJobBatch at the start of a tick, and cleared when it ends. */
export function setTickDeadline(at: number | null): void {
  deadlineAt = at;
}

/**
 * Milliseconds left in this tick. `Infinity` when no tick is active — a
 * service called outside the job runner (a route, a test) must never
 * self-limit.
 */
export function remainingTickMs(): number {
  return deadlineAt === null ? Infinity : deadlineAt - Date.now();
}

/**
 * True when less than `reserveMs` remains, i.e. there is not enough time to
 * safely start another unit of work. Callers pass the realistic worst-case
 * cost of one iteration, so the check is "can I afford another one", not
 * "am I already over".
 */
export function tickBudgetExhausted(reserveMs: number): boolean {
  return remainingTickMs() <= reserveMs;
}
