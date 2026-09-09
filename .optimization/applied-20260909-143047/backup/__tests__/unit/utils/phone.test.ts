import {
  normalizePhone,
  isValidKenyanPhone,
  formatPhoneDisplay,
} from '@/lib/utils/phone';

describe('normalizePhone', () => {
  it('normalises 07XXXXXXXX format', () => {
    expect(normalizePhone('0712345678')).toBe('254712345678');
    expect(normalizePhone('0100123456')).toBe('254100123456');
  });

  it('normalises +2547XXXXXXXX format', () => {
    expect(normalizePhone('+254712345678')).toBe('254712345678');
  });

  it('normalises 2547XXXXXXXX format (no plus)', () => {
    expect(normalizePhone('254712345678')).toBe('254712345678');
  });

  it('normalises 7XXXXXXXX format (9 digits starting with 7)', () => {
    expect(normalizePhone('712345678')).toBe('254712345678');
  });

  it('normalises 1XXXXXXXX format (9 digits starting with 1)', () => {
    expect(normalizePhone('100123456')).toBe('254100123456');
  });

  it('strips non-digit characters before normalising', () => {
    expect(normalizePhone('+254 712-345-678')).toBe('254712345678');
    expect(normalizePhone('0712 345 678')).toBe('254712345678');
  });

  it('throws for invalid numbers', () => {
    expect(() => normalizePhone('12345')).toThrow('Invalid Kenyan phone number');
    expect(() => normalizePhone('abc')).toThrow();
    expect(() => normalizePhone('')).toThrow();
  });
});

describe('isValidKenyanPhone', () => {
  it('returns true for valid formats', () => {
    expect(isValidKenyanPhone('0712345678')).toBe(true);
    expect(isValidKenyanPhone('+254712345678')).toBe(true);
    expect(isValidKenyanPhone('712345678')).toBe(true);
  });

  it('returns false for invalid formats', () => {
    expect(isValidKenyanPhone('12345')).toBe(false);
    expect(isValidKenyanPhone('invalid')).toBe(false);
    expect(isValidKenyanPhone('')).toBe(false);
  });
});

describe('formatPhoneDisplay', () => {
  it('formats E.164 to local display format', () => {
    expect(formatPhoneDisplay('254712345678')).toBe('0712 345 678');
    expect(formatPhoneDisplay('254100123456')).toBe('0100 123 456');
  });
});

describe('mobile-only validation (SMS-AUDIT-v3 V3-03)', () => {
  it('accepts every real Kenyan mobile format', () => {
    // All the same subscriber, however it was typed.
    for (const input of [
      '0722123456', '+254722123456', '254722123456', '722123456',
      '07 22 12 34 56', '+254-722-123-456',
    ]) {
      expect(normalizePhone(input)).toBe('254722123456');
    }
  });

  it('accepts the 01xx mobile range', () => {
    expect(normalizePhone('0110123456')).toBe('254110123456');
  });

  it.each([
    ['020 1234567', 'Nairobi landline'],
    ['0412234567', 'Mombasa landline'],
    ['0512234567', 'Nakuru landline'],
  ])('rejects %s (%s)', (input) => {
    // These used to normalise happily, then reserve credit, dispatch, fail at
    // the provider and burn the whole retry budget.
    expect(() => normalizePhone(input)).toThrow(/Invalid Kenyan phone number/);
    expect(isValidKenyanPhone(input)).toBe(false);
  });

  it('still rejects malformed and foreign numbers', () => {
    expect(() => normalizePhone('2547221234567')).toThrow();  // 13 digits
    expect(() => normalizePhone('+447911123456')).toThrow();  // UK
    expect(() => normalizePhone('')).toThrow();
  });

  it('throws the documented Error, not a TypeError, for a non-string', () => {
    // Callers catch on the message; a TypeError escapes guards written
    // against this contract.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => normalizePhone(null as any)).toThrow(/Invalid Kenyan phone number/);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => normalizePhone(undefined as any)).toThrow(/Invalid Kenyan phone number/);
  });
});
