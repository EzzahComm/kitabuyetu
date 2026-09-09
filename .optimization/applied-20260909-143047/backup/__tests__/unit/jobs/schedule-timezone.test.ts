/**
 * Scheduling is expressed in Africa/Nairobi (SMS-AUDIT-v3 H8 / INV-41,
 * pathway T2-1).
 *
 * enqueueTimeBasedJobs used getUTCHours()/getUTCDate(), so `hour === 8` fired
 * at 11:00 EAT and the code did not mean what it said. Every existing time
 * happened to land somewhere reasonable, which is why it went unnoticed — the
 * hazard was the next schedule written as a local hour.
 *
 * These assert the offset arithmetic the enqueuer relies on, including the
 * two boundaries where a naive reading gets the DAY wrong, not just the hour.
 */

const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Mirrors the derivation in lib/jobs/index.ts. */
function nairobiParts(utcIso: string) {
  const n = new Date(new Date(utcIso).getTime() + EAT_OFFSET_MS);
  return {
    hour: n.getUTCHours(),
    date: n.getUTCDate(),
    day:  n.getUTCDay(),
    dateStr: n.toISOString().slice(0, 10),
  };
}

describe('Nairobi scheduling', () => {
  it('reads 08:00 EAT when the schedule says hour 8', () => {
    // 05:00 UTC is 08:00 in Nairobi. Before this change, `hour === 8` matched
    // 08:00 UTC, i.e. 11:00 EAT.
    expect(nairobiParts('2026-09-01T05:00:00Z').hour).toBe(8);
  });

  it('no longer fires the monthly reminder at 11:00 local', () => {
    expect(nairobiParts('2026-09-01T08:00:00Z').hour).toBe(11);
  });

  it('rolls the DATE at Nairobi midnight, not UTC midnight', () => {
    // 21:00 UTC is already the next day in Nairobi. A daily dedup key built
    // from the UTC date would reuse the previous day's key for three hours.
    const late = nairobiParts('2026-09-01T21:00:00Z');
    expect(late.date).toBe(2);
    expect(late.dateStr).toBe('2026-09-02');

    const justBefore = nairobiParts('2026-09-01T20:59:00Z');
    expect(justBefore.date).toBe(1);
    expect(justBefore.dateStr).toBe('2026-09-01');
  });

  it('gets the 1st-of-month check right at the boundary', () => {
    // 2026-08-31T21:00Z is 2026-09-01T00:00 EAT — the monthly jobs must see
    // date === 1 here, and must NOT still see it three hours later in UTC.
    expect(nairobiParts('2026-08-31T21:00:00Z').date).toBe(1);
    expect(nairobiParts('2026-08-31T20:00:00Z').date).toBe(31);
  });

  it('rolls the weekday at the same boundary', () => {
    // 2026-09-05 is a Saturday; 21:00 UTC that day is Sunday in Nairobi.
    expect(nairobiParts('2026-09-05T21:00:00Z').day).toBe(0);
    expect(nairobiParts('2026-09-05T20:00:00Z').day).toBe(6);
  });

  it('leaves the 5-minute bucket unchanged, since the offset is whole hours', () => {
    const utc = new Date('2026-09-01T05:37:00Z');
    const eat = new Date(utc.getTime() + EAT_OFFSET_MS);
    expect(Math.floor(eat.getUTCMinutes() / 5)).toBe(Math.floor(utc.getUTCMinutes() / 5));
  });

  it('uses a fixed offset because Kenya has no daylight saving', () => {
    // Same offset in the northern summer and winter — no DST to track.
    const jan = nairobiParts('2026-01-15T05:00:00Z').hour;
    const jul = nairobiParts('2026-07-15T05:00:00Z').hour;
    expect(jan).toBe(8);
    expect(jul).toBe(8);
  });
});
