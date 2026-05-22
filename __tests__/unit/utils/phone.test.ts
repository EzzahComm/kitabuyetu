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
