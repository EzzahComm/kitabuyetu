/**
 * governance.service.ts's RAG-band resolution — pure boundary-condition
 * logic, tested in isolation since a subtle off-by-one here would
 * misclassify a real group's financial health. Covers the 3 threshold
 * shapes actually seeded in migration 069: higher_better (only a min),
 * lower_better (only a max), and band (both min and max).
 */
import { resolveRag, type ThresholdRow } from '@/lib/services/governance.service';

function threshold(overrides: Partial<ThresholdRow> = {}): ThresholdRow {
  return {
    metric_code: 'test',
    green_min: null, green_max: null,
    amber_min: null, amber_max: null,
    ...overrides,
  };
}

describe('resolveRag', () => {
  it('returns na when value is null', () => {
    expect(resolveRag(null, threshold({ green_min: '15' }))).toBe('na');
  });

  it('returns na when no threshold row exists for the metric', () => {
    expect(resolveRag(50, undefined)).toBe('na');
  });

  describe('higher_better shape (only a min, e.g. liquidity_ratio: green>=15, amber>=10)', () => {
    const t = threshold({ green_min: '15', amber_min: '10' });
    it('green at and above the green floor', () => {
      expect(resolveRag(15, t)).toBe('green');
      expect(resolveRag(20, t)).toBe('green');
    });
    it('amber between the amber and green floors', () => {
      expect(resolveRag(10, t)).toBe('amber');
      expect(resolveRag(14.9, t)).toBe('amber');
    });
    it('red below the amber floor', () => {
      expect(resolveRag(9.99, t)).toBe('red');
      expect(resolveRag(0, t)).toBe('red');
      expect(resolveRag(-5, t)).toBe('red');
    });
  });

  describe('lower_better shape (only a max, e.g. par30: green<=5, amber<=10)', () => {
    const t = threshold({ green_max: '5', amber_max: '10' });
    it('green at and below the green ceiling', () => {
      expect(resolveRag(0, t)).toBe('green');
      expect(resolveRag(5, t)).toBe('green');
    });
    it('amber between the green and amber ceilings', () => {
      expect(resolveRag(5.1, t)).toBe('amber');
      expect(resolveRag(10, t)).toBe('amber');
    });
    it('red above the amber ceiling', () => {
      expect(resolveRag(10.1, t)).toBe('red');
      expect(resolveRag(100, t)).toBe('red');
    });
  });

  describe('band shape (both min and max, e.g. ldr: green 60-90, amber 40-100)', () => {
    const t = threshold({ green_min: '60', green_max: '90', amber_min: '40', amber_max: '100' });
    it('green inside the band', () => {
      expect(resolveRag(60, t)).toBe('green');
      expect(resolveRag(75, t)).toBe('green');
      expect(resolveRag(90, t)).toBe('green');
    });
    it('amber inside the wider amber band but outside green', () => {
      expect(resolveRag(40, t)).toBe('amber');
      expect(resolveRag(59, t)).toBe('amber');
      expect(resolveRag(91, t)).toBe('amber');
      expect(resolveRag(100, t)).toBe('amber');
    });
    it('red outside both bands on either side', () => {
      expect(resolveRag(39.9, t)).toBe('red');
      expect(resolveRag(100.1, t)).toBe('red');
    });
  });
});
