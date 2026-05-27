import { allocateSplit, type SplitRule } from '@/lib/utils/split-allocator';

// Helper: each test verifies the allocation invariant — sum(amount_cents) === input * 100
const sumCents = (allocs: { amount_cents: number }[]) =>
  allocs.reduce((a, x) => a + x.amount_cents, 0);

const rule = (over: Partial<SplitRule>): SplitRule => ({
  account_code: '4001',
  percentage:   null,
  fixed_amount: null,
  priority:     100,
  ...over,
});

describe('allocateSplit — empty / degenerate input', () => {
  it('returns empty array for zero amount', () => {
    expect(allocateSplit(0, [], '4001')).toEqual([]);
  });

  it('returns empty array for negative amount', () => {
    expect(allocateSplit(-100, [], '4001')).toEqual([]);
  });

  it('sends everything to the default account when no rules', () => {
    const out = allocateSplit(1500, [], '4001');
    expect(out).toEqual([{ account_code: '4001', amount: 1500, amount_cents: 150000 }]);
  });
});

describe('allocateSplit — percentage rules', () => {
  it('splits 50/50 evenly when divisible', () => {
    const out = allocateSplit(1000, [
      rule({ account_code: 'A', percentage: 50 }),
      rule({ account_code: 'B', percentage: 50 }),
    ], '4001');
    expect(out).toEqual([
      { account_code: 'A', amount: 500, amount_cents: 50000 },
      { account_code: 'B', amount: 500, amount_cents: 50000 },
    ]);
    expect(sumCents(out)).toBe(100000);
  });

  it('uses largest-remainder for 33.33/33.33/33.33 on KES 100', () => {
    const out = allocateSplit(100, [
      rule({ account_code: 'A', percentage: 33.33, priority: 1 }),
      rule({ account_code: 'B', percentage: 33.33, priority: 2 }),
      rule({ account_code: 'C', percentage: 33.33, priority: 3 }),
    ], '4001');
    // Total pct = 99.99 → 99 cents allocated by floors, 1 cent leftover by
    // largest remainder (all .0 — ties broken by priority → A wins).
    // Then the remaining 100 - 9999/100 = 0.01 → default account.
    // 33.33% of 10000 = 3333.0 exactly → floors 3333, remainders 0.
    // sum floors = 9999. leftover cents from pct round = 0 (no fractional).
    // But totalPct=99.99 means we under-allocate by 1 cent which goes to default.
    expect(sumCents(out)).toBe(10000);
    expect(out.find((a) => a.account_code === 'A')?.amount_cents).toBe(3333);
    expect(out.find((a) => a.account_code === 'B')?.amount_cents).toBe(3333);
    expect(out.find((a) => a.account_code === 'C')?.amount_cents).toBe(3333);
    expect(out.find((a) => a.account_code === '4001')?.amount_cents).toBe(1);
  });

  it('largest-remainder handles 1/3 splits exactly on KES 100', () => {
    // 33.34/33.33/33.33 — sums to 100, no default leftover
    const out = allocateSplit(100, [
      rule({ account_code: 'A', percentage: 33.34, priority: 1 }),
      rule({ account_code: 'B', percentage: 33.33, priority: 2 }),
      rule({ account_code: 'C', percentage: 33.33, priority: 3 }),
    ], '4001');
    expect(sumCents(out)).toBe(10000);
    expect(out.find((a) => a.account_code === 'A')?.amount_cents).toBe(3334);
    expect(out.find((a) => a.account_code === 'B')?.amount_cents).toBe(3333);
    expect(out.find((a) => a.account_code === 'C')?.amount_cents).toBe(3333);
    expect(out.find((a) => a.account_code === '4001')).toBeUndefined();
  });

  it('scales down when percentages exceed 100', () => {
    // 60/60 should not over-allocate; scale to 50/50
    const out = allocateSplit(1000, [
      rule({ account_code: 'A', percentage: 60 }),
      rule({ account_code: 'B', percentage: 60 }),
    ], '4001');
    expect(sumCents(out)).toBe(100000);
    expect(out.find((a) => a.account_code === 'A')?.amount_cents).toBe(50000);
    expect(out.find((a) => a.account_code === 'B')?.amount_cents).toBe(50000);
  });

  it('dumps leftover to default when percentages sum to less than 100', () => {
    const out = allocateSplit(1000, [
      rule({ account_code: 'A', percentage: 70 }),
    ], '4001');
    expect(sumCents(out)).toBe(100000);
    expect(out.find((a) => a.account_code === 'A')?.amount_cents).toBe(70000);
    expect(out.find((a) => a.account_code === '4001')?.amount_cents).toBe(30000);
  });
});

describe('allocateSplit — fixed-amount rules', () => {
  it('applies fixed lines in priority order', () => {
    const out = allocateSplit(3000, [
      rule({ account_code: 'WELFARE',  fixed_amount: 500, priority: 1 }),
      rule({ account_code: 'SAVINGS',  percentage: 50,    priority: 2 }),
      rule({ account_code: 'INVEST',   percentage: 50,    priority: 3 }),
    ], '4001');
    expect(sumCents(out)).toBe(300000);
    expect(out.find((a) => a.account_code === 'WELFARE')?.amount_cents).toBe(50000);
    expect(out.find((a) => a.account_code === 'SAVINGS')?.amount_cents).toBe(125000);
    expect(out.find((a) => a.account_code === 'INVEST')?.amount_cents).toBe(125000);
  });

  it('partially allocates a fixed line when amount is smaller', () => {
    const out = allocateSplit(300, [
      rule({ account_code: 'WELFARE', fixed_amount: 500 }),
    ], '4001');
    expect(out).toEqual([{ account_code: 'WELFARE', amount: 300, amount_cents: 30000 }]);
    expect(sumCents(out)).toBe(30000);
  });

  it('stops applying once amount is exhausted by fixed lines', () => {
    const out = allocateSplit(500, [
      rule({ account_code: 'WELFARE',  fixed_amount: 300, priority: 1 }),
      rule({ account_code: 'EMERGENCY', fixed_amount: 300, priority: 2 }),
      rule({ account_code: 'SAVINGS',  percentage: 100,   priority: 3 }),
    ], '4001');
    expect(sumCents(out)).toBe(50000);
    expect(out.find((a) => a.account_code === 'WELFARE')?.amount_cents).toBe(30000);
    expect(out.find((a) => a.account_code === 'EMERGENCY')?.amount_cents).toBe(20000);
    expect(out.find((a) => a.account_code === 'SAVINGS')).toBeUndefined();
  });
});

describe('allocateSplit — invariants', () => {
  it('total allocation always equals input', () => {
    const fixtures: Array<{ amount: number; rules: SplitRule[] }> = [
      { amount: 100,    rules: [rule({ account_code: 'A', percentage: 33.33 }), rule({ account_code: 'B', percentage: 33.33 }), rule({ account_code: 'C', percentage: 33.34 })] },
      { amount: 7777,   rules: [rule({ account_code: 'A', percentage: 25 }), rule({ account_code: 'B', percentage: 25 }), rule({ account_code: 'C', percentage: 50 })] },
      { amount: 12345,  rules: [rule({ account_code: 'A', fixed_amount: 500 }), rule({ account_code: 'B', percentage: 60 }), rule({ account_code: 'C', percentage: 40 })] },
      { amount: 999.99, rules: [rule({ account_code: 'A', percentage: 100 })] },
    ];
    for (const f of fixtures) {
      const out = allocateSplit(f.amount, f.rules, '4001');
      expect(sumCents(out)).toBe(Math.round(f.amount * 100));
    }
  });

  it('merges multiple rules targeting the same account', () => {
    const out = allocateSplit(1000, [
      rule({ account_code: 'A', percentage: 50, priority: 1 }),
      rule({ account_code: 'A', percentage: 50, priority: 2 }),
    ], '4001');
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ account_code: 'A', amount: 1000, amount_cents: 100000 });
  });
});
