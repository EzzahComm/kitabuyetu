import { describe, it, expect } from 'vitest';
import { parseFuzzyDate, validateFuzzyDate, formatFuzzyDate, fuzzyDateToRange } from './fuzzy-date';

describe('FuzzyDate', () => {
  describe('parse', () => {
    it('parses ISO year', () => {
      const result = parseFuzzyDate('1952');
      expect(result).toEqual({ year: 1952, precision: 'year' });
    });

    it('parses ISO year-month', () => {
      const result = parseFuzzyDate('1960-03');
      expect(result).toEqual({ year: 1960, month: 3, precision: 'month' });
    });

    it('parses ISO full date', () => {
      const result = parseFuzzyDate('1960-03-15');
      expect(result?.year).toBe(1960);
      expect(result?.month).toBe(3);
      expect(result?.day).toBe(15);
      expect(result?.precision).toBe('day');
    });

    it('parses "about" format', () => {
      const result = parseFuzzyDate('about 1950');
      expect(result?.year).toBe(1950);
    });

    it('returns null for invalid format', () => {
      expect(parseFuzzyDate('invalid')).toBeNull();
    });
  });

  describe('validate', () => {
    it('accepts valid year-only date', () => {
      expect(validateFuzzyDate({ year: 1952, precision: 'year' })).toBe(true);
    });

    it('rejects future year', () => {
      const future = new Date().getFullYear() + 1;
      expect(validateFuzzyDate({ year: future, precision: 'year' })).toBe(false);
    });

    it('rejects invalid month', () => {
      expect(validateFuzzyDate({ year: 1952, month: 13, precision: 'month' })).toBe(false);
    });

    it('rejects mismatched precision', () => {
      expect(validateFuzzyDate({ year: 1952, precision: 'month' })).toBe(false);
    });
  });

  describe('format', () => {
    it('formats year in English', () => {
      expect(formatFuzzyDate({ year: 1952, precision: 'year' }, 'en')).toBe('1952');
    });

    it('formats month in English', () => {
      const result = formatFuzzyDate({ year: 1960, month: 3, precision: 'month' }, 'en');
      expect(result).toContain('Mar');
      expect(result).toContain('1960');
    });

    it('formats month in Swahili', () => {
      const result = formatFuzzyDate({ year: 1960, month: 3, precision: 'month' }, 'sw');
      expect(result).toContain('Mar');
    });
  });

  describe('range', () => {
    it('returns year range for year precision', () => {
      const range = fuzzyDateToRange({ year: 1952, precision: 'year' });
      expect(range.start.getFullYear()).toBe(1952);
      expect(range.end.getFullYear()).toBe(1952);
      expect(range.end.getMonth()).toBe(11);
    });

    it('returns month range for month precision', () => {
      const range = fuzzyDateToRange({ year: 1960, month: 3, precision: 'month' });
      expect(range.start.getMonth()).toBe(2);
      expect(range.end.getMonth()).toBe(2);
    });
  });
});
