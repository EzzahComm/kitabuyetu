import {
  toDecimal,
  addDecimal,
  subtractDecimal,
  multiplyDecimal,
  toMpesaAmount,
} from '@/lib/utils/currency';

describe('toDecimal', () => {
  it('rounds to 2 decimal places', () => {
    // 1.005 in IEEE 754 is ~1.0049999..., so toFixed(2) = '1.00' (not '1.01')
    expect(toDecimal(1.005)).toBe('1.00');
    expect(toDecimal(1.006)).toBe('1.01');
    expect(toDecimal(100)).toBe('100.00');
    expect(toDecimal(0.1 + 0.2)).toBe('0.30');
  });

  it('handles zero and negative', () => {
    expect(toDecimal(0)).toBe('0.00');
    expect(toDecimal(-50.5)).toBe('-50.50');
  });
});

describe('addDecimal', () => {
  it('adds two decimal strings', () => {
    expect(addDecimal('100.50', '50.25')).toBe('150.75');
    expect(addDecimal('0.00', '0.01')).toBe('0.01');
  });

  it('avoids floating-point representation errors', () => {
    expect(addDecimal('0.1', '0.2')).toBe('0.30');
  });
});

describe('subtractDecimal', () => {
  it('subtracts two decimal strings', () => {
    expect(subtractDecimal('200.00', '50.50')).toBe('149.50');
    expect(subtractDecimal('100.00', '100.00')).toBe('0.00');
  });

  it('can produce negative results', () => {
    expect(subtractDecimal('10.00', '20.00')).toBe('-10.00');
  });
});

describe('multiplyDecimal', () => {
  it('multiplies by a number', () => {
    expect(multiplyDecimal('100.00', 1.5)).toBe('150.00');
    expect(multiplyDecimal('333.33', 3)).toBe('999.99');
  });

  it('accepts a string multiplier', () => {
    expect(multiplyDecimal('50.00', '2')).toBe('100.00');
  });
});

describe('toMpesaAmount', () => {
  it('floors to integer shillings', () => {
    expect(toMpesaAmount(1500.99)).toBe(1500);
    expect(toMpesaAmount(1500.01)).toBe(1500);
    expect(toMpesaAmount(1500)).toBe(1500);
  });

  it('accepts a string input', () => {
    expect(toMpesaAmount('2000.75')).toBe(2000);
  });

  it('returns 0 for zero input', () => {
    expect(toMpesaAmount(0)).toBe(0);
  });
});
