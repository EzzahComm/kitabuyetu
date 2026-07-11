import { evaluateCondition } from '@/lib/sms/conditions';

describe('evaluateCondition', () => {
  const payload = {
    amount:   '1500.00',   // NUMERIC arrives from pg as a string
    status:   'completed',
    receipt:  'QK12ABC',
    overdue:  true,
    phone:    null,
    penalty:  0,
  };

  it('treats an empty condition as an unconditional match', () => {
    expect(evaluateCondition({}, payload)).toBe(true);
  });

  it('compares NUMERIC strings numerically, not lexically', () => {
    // Lexical comparison would make '1500.00' < '900' true.
    expect(evaluateCondition({ field: 'amount', op: 'gt', value: 900 }, payload)).toBe(true);
    expect(evaluateCondition({ field: 'amount', op: 'gte', value: 1500 }, payload)).toBe(true);
    expect(evaluateCondition({ field: 'amount', op: 'lt', value: 1500 }, payload)).toBe(false);
  });

  it('equates 1500.00 with 1500 across string/number boundaries', () => {
    expect(evaluateCondition({ field: 'amount', op: 'eq', value: 1500 }, payload)).toBe(true);
    expect(evaluateCondition({ field: 'amount', op: 'neq', value: 1500 }, payload)).toBe(false);
  });

  it('does not coerce a non-numeric string into 0', () => {
    expect(evaluateCondition({ field: 'status', op: 'eq', value: 0 }, payload)).toBe(false);
    expect(evaluateCondition({ field: 'status', op: 'gt', value: -1 }, payload)).toBe(false);
  });

  it('distinguishes a zero value from an absent one', () => {
    expect(evaluateCondition({ field: 'penalty', op: 'eq', value: 0 }, payload)).toBe(true);
    expect(evaluateCondition({ field: 'penalty', op: 'exists' }, payload)).toBe(true);
  });

  it('treats null and missing fields as non-existent', () => {
    expect(evaluateCondition({ field: 'phone', op: 'exists' }, payload)).toBe(false);
    expect(evaluateCondition({ field: 'nope', op: 'exists' }, payload)).toBe(false);
    expect(evaluateCondition({ field: 'phone', op: 'exists', value: false }, payload)).toBe(true);
  });

  it('never matches a comparison against a null field', () => {
    expect(evaluateCondition({ field: 'phone', op: 'eq', value: 'x' }, payload)).toBe(false);
    expect(evaluateCondition({ field: 'phone', op: 'neq', value: 'x' }, payload)).toBe(false);
  });

  it('supports in / nin / contains', () => {
    expect(evaluateCondition({ field: 'status', op: 'in', value: ['completed', 'settled'] }, payload)).toBe(true);
    expect(evaluateCondition({ field: 'status', op: 'nin', value: ['failed'] }, payload)).toBe(true);
    expect(evaluateCondition({ field: 'receipt', op: 'contains', value: 'qk12' }, payload)).toBe(true);
  });

  it('composes all / any / not', () => {
    expect(evaluateCondition({
      all: [
        { field: 'status', op: 'eq', value: 'completed' },
        { field: 'amount', op: 'gte', value: 1000 },
      ],
    }, payload)).toBe(true);

    expect(evaluateCondition({
      all: [
        { field: 'status', op: 'eq', value: 'completed' },
        { field: 'amount', op: 'gte', value: 5000 },
      ],
    }, payload)).toBe(false);

    expect(evaluateCondition({
      any: [
        { field: 'status', op: 'eq', value: 'failed' },
        { field: 'overdue', op: 'eq', value: true },
      ],
    }, payload)).toBe(true);

    expect(evaluateCondition({ not: { field: 'status', op: 'eq', value: 'failed' } }, payload)).toBe(true);
  });

  it('returns false for malformed conditions rather than throwing', () => {
    // A corrupt rule row must not take down the transaction that emitted the event.
    expect(evaluateCondition(null, payload)).toBe(false);
    expect(evaluateCondition('DROP TABLE members', payload)).toBe(false);
    expect(evaluateCondition({ field: 'amount' }, payload)).toBe(false);
    expect(evaluateCondition({ field: 'amount', op: 'regex', value: '.*' }, payload)).toBe(false);
    expect(evaluateCondition([{ field: 'amount', op: 'eq', value: 1 }], payload)).toBe(false);
  });

  it('bounds pathologically nested conditions instead of blowing the stack', () => {
    let deep: unknown = { field: 'status', op: 'eq', value: 'completed' };
    for (let i = 0; i < 50; i++) deep = { all: [deep] };
    expect(() => evaluateCondition(deep, payload)).not.toThrow();
    expect(evaluateCondition(deep, payload)).toBe(false);
  });
});
