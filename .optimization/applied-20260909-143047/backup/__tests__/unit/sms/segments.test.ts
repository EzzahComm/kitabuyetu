/**
 * Segment counting (SMS-AUDIT-v3 G5 / INV-02, INV-03).
 *
 * Billing charged 1 credit per recipient regardless of length while the
 * provider bills per segment, and the compose UI used a third number
 * (ceil(len/160)) that was wrong because 160 is the SINGLE-segment size —
 * concatenated parts hold 153 GSM-7 characters, the rest going to the UDH.
 */
import { countSegments, segmentsOf } from '@/lib/sms/segments';

const g = (n: number) => 'a'.repeat(n);

describe('GSM-7 boundaries', () => {
  it('treats an empty body as one billable segment', () => {
    // It still gets sent and charged; 0 would let a reservation of nothing through.
    expect(segmentsOf('')).toBe(1);
  });

  it('fits 160 characters in a single segment', () => {
    expect(countSegments(g(160))).toMatchObject({ encoding: 'gsm7', segments: 1 });
  });

  it('splits at 161 — into 153-character parts, not 160', () => {
    expect(segmentsOf(g(161))).toBe(2);
    expect(segmentsOf(g(306))).toBe(2);
    expect(segmentsOf(g(307))).toBe(3);
  });

  it('counts the real welcome template as one segment', () => {
    const body = 'Dear Florence, you have joined Ndengelwa Community Water Project on Kitabu Yetu. Your member number is NC000086. Karibu.';
    expect(segmentsOf(body)).toBe(1);
  });
});

describe('GSM-7 extension characters cost two septets', () => {
  it.each(['^', '{', '}', '[', ']', '~', '|', '€'])('%s counts double', (ch) => {
    expect(countSegments(ch).units).toBe(2);
  });

  it('a backslash counts double', () => {
    expect(countSegments(String.fromCharCode(92)).units).toBe(2);
  });

  it('80 euro signs fill one whole segment, 81 spill into a second', () => {
    expect(countSegments('€'.repeat(80))).toMatchObject({ encoding: 'gsm7', units: 160, segments: 1 });
    expect(segmentsOf('€'.repeat(81))).toBe(2);
  });
});

describe('UCS-2 — the trap that makes a short message expensive', () => {
  it('one emoji drops capacity from 160 to 70', () => {
    expect(segmentsOf(g(100))).toBe(1);
    const withEmoji = g(100) + '\u{1F600}';
    expect(countSegments(withEmoji).encoding).toBe('ucs2');
    expect(segmentsOf(withEmoji)).toBe(2);
  });

  it('a curly apostrophe alone forces UCS-2', () => {
    expect(countSegments('Karibu’').encoding).toBe('ucs2');
  });

  it('honours the 70 / 67 boundaries', () => {
    expect(segmentsOf('中'.repeat(70))).toBe(1);
    expect(segmentsOf('中'.repeat(71))).toBe(2);
    expect(segmentsOf('中'.repeat(134))).toBe(2);
    expect(segmentsOf('中'.repeat(135))).toBe(3);
  });

  it('bills an astral emoji as the two code units it occupies on the wire', () => {
    const info = countSegments('\u{1F600}');
    expect(info.characters).toBe(1);
    expect(info.units).toBe(2);
  });
});

describe('quote and bill now agree', () => {
  it('diverges from the old ceil(len/160) estimate where it matters', () => {
    expect(segmentsOf(g(300))).toBe(2);
    // 320 is the validator's own cap: the old UI said 2, the provider bills 3.
    expect(Math.ceil(320 / 160)).toBe(2);
    expect(segmentsOf(g(320))).toBe(3);
  });
});
