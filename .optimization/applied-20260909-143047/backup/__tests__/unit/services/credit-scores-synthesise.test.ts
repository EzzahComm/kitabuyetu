/**
 * credit-scores.service.ts's synthesise() — proves the LoanPolicy wiring is
 * live: the reliability tier (and its loan multiplier) come from whatever
 * tierThresholds ladder is passed in, not a hardcoded constant
 * (ACCOUNTING_ARCHITECTURE_AUDIT.md §29.6's literal example).
 */
import { synthesise, type ComponentScore } from '@/lib/services/credit-scores.service';
import type { TierThreshold } from '@/lib/services/loan-policy.service';

jest.mock('@/lib/db', () => ({
  withDb: jest.fn(),
  withTransaction: jest.fn(),
}));
jest.mock('@/lib/services/loan-policy.service', () => ({
  getEffectiveTierThresholds: jest.fn(),
}));

const DEFAULT_LADDER: TierThreshold[] = [
  { tier: 'excellent', min: 85, loanMultiplier: 10   },
  { tier: 'good',      min: 70, loanMultiplier: 5    },
  { tier: 'fair',      min: 55, loanMultiplier: 3    },
  { tier: 'poor',      min: 40, loanMultiplier: 1    },
  { tier: 'high_risk', min: 0,  loanMultiplier: 0.5  },
];

// Real per-component weights (financial keys sum to 1.0, social keys sum to
// 1.0 — mirrors credit-scores.service.ts's FINANCIAL_WEIGHTS/SOCIAL_WEIGHTS).
// All components at a flat `score` → financial = social = overall = score,
// since a weighted sum of equal values (weights summing to 1) equals that value.
const WEIGHTS: Record<string, number> = {
  contribution_consistency: 0.30,
  loan_repayment:           0.30,
  savings_growth:           0.20,
  share_ownership:          0.15,
  dividend_participation:   0.05,
  meeting_attendance:       0.50,
  welfare_participation:    0.25,
  leadership_role:          0.25,
};

function flatComponents(score: number, totalSavings = 10000): Record<string, ComponentScore> {
  const out: Record<string, ComponentScore> = {};
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    out[key] = {
      score, weight,
      raw: key === 'contribution_consistency' ? { total_completed_amount: totalSavings } : {},
    };
  }
  return out;
}

describe('synthesise', () => {
  it('assigns the tier/multiplier from the DEFAULT ladder for an overall score of 60 (fair)', () => {
    const result = synthesise(flatComponents(60) as never, DEFAULT_LADDER);
    expect(result.overallScore).toBe(60);
    expect(result.tier).toBe('fair');
    expect(result.loanEligibility).toBe(30000); // 10000 savings * 3x multiplier
  });

  it('assigns a DIFFERENT tier for the same score under a custom ladder — proves the wiring is live', () => {
    const stricterLadder: TierThreshold[] = [
      { tier: 'excellent', min: 90, loanMultiplier: 10  },
      { tier: 'good',      min: 80, loanMultiplier: 5   },
      { tier: 'fair',      min: 65, loanMultiplier: 3   }, // fair now requires 65, not 55
      { tier: 'poor',      min: 40, loanMultiplier: 1   },
      { tier: 'high_risk', min: 0,  loanMultiplier: 0.5 },
    ];
    const result = synthesise(flatComponents(60) as never, stricterLadder);
    expect(result.tier).toBe('poor'); // 60 no longer clears the raised 'fair' bar
    expect(result.loanEligibility).toBe(10000); // 10000 savings * 1x multiplier
  });

  it('honors a custom loanMultiplier at the same tier', () => {
    const richerLadder = DEFAULT_LADDER.map((t) => (t.tier === 'fair' ? { ...t, loanMultiplier: 4 } : t));
    const result = synthesise(flatComponents(60) as never, richerLadder);
    expect(result.tier).toBe('fair');
    expect(result.loanEligibility).toBe(40000); // 10000 savings * 4x multiplier
  });
});
