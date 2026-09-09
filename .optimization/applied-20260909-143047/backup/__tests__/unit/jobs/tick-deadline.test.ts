/**
 * Job-tick deadline (SMS-AUDIT-v3 G2, pathway T1-1).
 *
 * app/api/cron/route.ts pins maxDuration = 60, which on Vercel's Hobby plan
 * is the hard platform ceiling and cannot be raised — so the audit's original
 * "raise it to 300" remedy is unavailable and the WORK has to bound itself
 * instead. processJobBatch's 50s budget is only checked before a job is
 * claimed, leaving ~10s for a job that can legitimately run for minutes.
 */
import { setTickDeadline, remainingTickMs, tickBudgetExhausted } from '@/lib/jobs/deadline';

describe('tick deadline', () => {
  afterEach(() => setTickDeadline(null));

  it('is unbounded when no tick is active', () => {
    // A service called from a route or a test must never self-limit.
    setTickDeadline(null);
    expect(remainingTickMs()).toBe(Infinity);
    expect(tickBudgetExhausted(60_000)).toBe(false);
  });

  it('reports the time left in the current tick', () => {
    setTickDeadline(Date.now() + 30_000);
    const left = remainingTickMs();
    expect(left).toBeGreaterThan(28_000);
    expect(left).toBeLessThanOrEqual(30_000);
  });

  it('allows another iteration when it comfortably fits', () => {
    setTickDeadline(Date.now() + 30_000);
    // A 16s DLR call inside 30s remaining.
    expect(tickBudgetExhausted(16_000)).toBe(false);
  });

  it('refuses an iteration that would not fit', () => {
    setTickDeadline(Date.now() + 10_000);
    // A 21s retry send inside 10s remaining — the case that used to get the
    // invocation killed mid-send, stranding an unresolved sms_failures row
    // whose message the provider may still have accepted.
    expect(tickBudgetExhausted(21_000)).toBe(true);
  });

  it('is exhausted once the deadline has passed', () => {
    setTickDeadline(Date.now() - 1);
    expect(tickBudgetExhausted(0)).toBe(true);
    expect(remainingTickMs()).toBeLessThanOrEqual(0);
  });

  it('does not leak across ticks', () => {
    setTickDeadline(Date.now() + 1_000);
    expect(tickBudgetExhausted(5_000)).toBe(true);
    setTickDeadline(null);
    expect(tickBudgetExhausted(5_000)).toBe(false);
  });
});
