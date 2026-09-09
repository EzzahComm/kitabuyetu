/**
 * Allocation engine decision table A1–A9 (payment architecture §3.5) plus the
 * account-suffix parser (A1/A3 inputs). The engine must be deterministic and
 * never guess — every branch here is an acceptance criterion from §20.
 */
import { resolveProduct, type OpenPaymentRequest } from '@/lib/utils/allocation-engine';
import { parseAccountRef } from '@/lib/utils/membership-no';

const req = (over: Partial<OpenPaymentRequest>): OpenPaymentRequest => ({
  id: 'r-1', product: 'savings', entityId: null, amount: 1000,
  createdAt: new Date('2026-07-01T10:00:00Z'), ...over,
});

const base = {
  suffix: null as null, openRequests: [] as OpenPaymentRequest[],
  memberDefault: null, groupDefault: 'savings' as const, amount: 1000,
};

describe('resolveProduct — decision table', () => {
  it('A2: exact-amount request wins', () => {
    const r = resolveProduct({ ...base, openRequests: [
      req({ id: 'r-old', product: 'welfare', amount: 500, createdAt: new Date('2026-07-01') }),
      req({ id: 'r-exact', product: 'loan_repayment', amount: 1000, createdAt: new Date('2026-07-02') }),
    ]});
    expect(r).toMatchObject({ product: 'loan_repayment', requestId: 'r-exact', amountVariance: false, tier: 'A2' });
  });

  it('A2 beats a suffix (suffix never overrides an exact match)', () => {
    const r = resolveProduct({ ...base, suffix: 'W', openRequests: [
      req({ id: 'r-exact', product: 'loan_repayment', amount: 1000 }),
    ]});
    expect(r).toMatchObject({ product: 'loan_repayment', requestId: 'r-exact', tier: 'A2' });
  });

  it('A2 tie-break: oldest exact match wins deterministically', () => {
    const r = resolveProduct({ ...base, openRequests: [
      req({ id: 'r-newer', product: 'welfare', amount: 1000, createdAt: new Date('2026-07-03') }),
      req({ id: 'r-older', product: 'savings', amount: 1000, createdAt: new Date('2026-07-01') }),
    ]});
    expect(r.requestId).toBe('r-older');
  });

  it('A3: valid suffix decides when no exact match', () => {
    expect(resolveProduct({ ...base, suffix: 'L' }))
      .toMatchObject({ product: 'loan_repayment', requestId: null, tier: 'A3' });
    expect(resolveProduct({ ...base, suffix: 'W' })).toMatchObject({ product: 'welfare', tier: 'A3' });
    expect(resolveProduct({ ...base, suffix: 'S' })).toMatchObject({ product: 'share', tier: 'A3' });
  });

  it('A3 beats non-exact open requests', () => {
    const r = resolveProduct({ ...base, suffix: 'W', openRequests: [
      req({ id: 'r-1', product: 'loan_repayment', amount: 750 }),
    ]});
    expect(r).toMatchObject({ product: 'welfare', requestId: null, tier: 'A3' });
  });

  it('A4: exactly one open request, amount differs → variance tagged', () => {
    const r = resolveProduct({ ...base, amount: 400, openRequests: [
      req({ id: 'r-1', product: 'loan_repayment', amount: 1000 }),
    ]});
    expect(r).toMatchObject({ product: 'loan_repayment', requestId: 'r-1', amountVariance: true, tier: 'A4' });
  });

  it('A5: multiple open, no exact match → OLDEST wins, variance tagged', () => {
    const r = resolveProduct({ ...base, amount: 400, openRequests: [
      req({ id: 'r-newer', product: 'welfare', amount: 900, createdAt: new Date('2026-07-05') }),
      req({ id: 'r-older', product: 'loan_repayment', amount: 800, createdAt: new Date('2026-07-01') }),
    ]});
    expect(r).toMatchObject({ product: 'loan_repayment', requestId: 'r-older', amountVariance: true, tier: 'A5' });
  });

  it('A7: member default when no requests/suffix', () => {
    const r = resolveProduct({ ...base, memberDefault: 'welfare' });
    expect(r).toMatchObject({ product: 'welfare', requestId: null, tier: 'A7' });
  });

  it('A8: group default as the final tier', () => {
    expect(resolveProduct(base)).toMatchObject({ product: 'savings', requestId: null, tier: 'A8' });
    expect(resolveProduct({ ...base, groupDefault: 'welfare' })).toMatchObject({ product: 'welfare', tier: 'A8' });
  });

  it('is deterministic (same input, same output)', () => {
    const input = { ...base, amount: 400, openRequests: [
      req({ id: 'b', amount: 700, createdAt: new Date('2026-07-01') }),
      req({ id: 'a', amount: 800, createdAt: new Date('2026-07-01') }),
    ]};
    expect(resolveProduct(input)).toEqual(resolveProduct(input));
    // created_at tie → id tie-break, not array order
    expect(resolveProduct(input).requestId).toBe('a');
  });
});

describe('parseAccountRef — suffix handling (A1/A3 inputs)', () => {
  it('parses valid suffixes in every human format', () => {
    for (const raw of ['BG102534-W', 'BG102534 W', 'bg102534w', 'BG 10253 4-W']) {
      expect(parseAccountRef(raw)).toEqual({ account: 'BG102534', suffix: 'W', invalidSuffix: false });
    }
    expect(parseAccountRef('BG102534-L').suffix).toBe('L');
    expect(parseAccountRef('BG102534-S').suffix).toBe('S');
  });

  it('A1: unknown trailing letter is flagged invalid, never guessed', () => {
    expect(parseAccountRef('BG102534-X')).toEqual({ account: 'BG102534', suffix: null, invalidSuffix: true });
  });

  it('bare numbers and non-membership refs pass through untouched', () => {
    expect(parseAccountRef('BG 10253 4')).toEqual({ account: 'BG102534', suffix: null, invalidSuffix: false });
    expect(parseAccountRef('KYT-CONTR-KY1234567')).toMatchObject({ suffix: null, invalidSuffix: false });
    expect(parseAccountRef('INV-2026-000123')).toMatchObject({ suffix: null, invalidSuffix: false });
  });
});
