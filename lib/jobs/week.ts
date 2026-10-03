/**
 * ISO 8601 week key (YYYY-WNN), extracted from lib/jobs/index.ts's own
 * toWeekStr() so both the cron dispatcher (dedup-keying the weekly trigger
 * itself) and a long-running handler (dedup-keying individual sends across
 * however many ticks one week's batch takes to drain) share one algorithm -
 * two independent copies would be a real drift risk for something idempotency
 * depends on. Standalone module, no imports, same reasoning as
 * lib/jobs/deadline.ts: index.ts -> processor.ts -> handlers.ts is already a
 * chain, so neither index.ts nor handlers.ts may import from the other.
 */
export function toIsoWeekKey(d: Date): string {
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayOfWeek = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayOfWeek);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}
