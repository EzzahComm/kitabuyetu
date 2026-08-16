/**
 * LoanPolicy — second Configuration Service domain (ACCOUNTING_ARCHITECTURE_AUDIT.md
 * §29.5/§33.5). Replaces credit-scores.service.ts's hardcoded TIER_THRESHOLDS
 * with a Platform -> Organization -> Group cascade, same shape as ApprovalPolicy.
 */
import { withDb, withTransaction } from '@/lib/db';
import { resolvePolicy, resolvePolicyDetailed, setPolicy } from '@/lib/services/configuration.service';
import { loanPolicyService, getEffectiveTierThresholds, type TierThreshold } from '@/lib/services/loan-policy.service';
import { ValidationError } from '@/lib/utils/errors';

jest.mock('@/lib/db', () => ({
  withDb: jest.fn(),
  withTransaction: jest.fn(),
}));
jest.mock('@/lib/services/configuration.service', () => ({
  resolvePolicy:         jest.fn(),
  resolvePolicyDetailed: jest.fn(),
  setPolicy:             jest.fn(),
}));

const mockQuery  = jest.fn();
const mockClient = { query: mockQuery };

beforeEach(() => {
  mockQuery.mockReset();
  (withDb as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
  (withTransaction as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
  (resolvePolicy as jest.Mock).mockReset();
  (resolvePolicyDetailed as jest.Mock).mockReset();
  (setPolicy as jest.Mock).mockReset().mockResolvedValue({ id: 'p-1', version: 2 });
});

const ctx = { groupId: 'g1', userId: 'user-1', role: 'chairperson', organizationId: 'org-1' };

const VALID_LADDER: TierThreshold[] = [
  { tier: 'excellent', min: 85, loanMultiplier: 10   },
  { tier: 'good',      min: 70, loanMultiplier: 5    },
  { tier: 'fair',      min: 55, loanMultiplier: 3    },
  { tier: 'poor',      min: 40, loanMultiplier: 1    },
  { tier: 'high_risk', min: 0,  loanMultiplier: 0.5  },
];

describe('getEffectiveTierThresholds', () => {
  it('resolves via the generic engine with the domain-specific fallback', async () => {
    (resolvePolicy as jest.Mock).mockResolvedValueOnce(VALID_LADDER);
    const result = await getEffectiveTierThresholds(mockClient as never, { groupId: 'g1' });
    expect(result).toEqual(VALID_LADDER);
    expect(resolvePolicy).toHaveBeenCalledWith(mockClient, 'loan', 'tier_thresholds', { groupId: 'g1' }, expect.any(Array));
  });
});

describe('loanPolicyService.getGroupPolicy', () => {
  it('returns the resolved ladder with provenance', async () => {
    (resolvePolicyDetailed as jest.Mock).mockResolvedValueOnce({ value: VALID_LADDER, source: 'platform' });
    const result = await loanPolicyService.getGroupPolicy(ctx);
    expect(result).toEqual({ thresholds: VALID_LADDER, source: 'platform' });
  });
});

describe('loanPolicyService.setGroupOverride', () => {
  it('rejects a ladder missing a tier', async () => {
    const incomplete = VALID_LADDER.slice(0, 4);
    await expect(loanPolicyService.setGroupOverride(ctx, incomplete)).rejects.toBeInstanceOf(ValidationError);
    expect(setPolicy).not.toHaveBeenCalled();
  });

  it('rejects a negative loanMultiplier', async () => {
    const bad = VALID_LADDER.map((t) => (t.tier === 'poor' ? { ...t, loanMultiplier: -1 } : t));
    await expect(loanPolicyService.setGroupOverride(ctx, bad)).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects non-descending tier minimums', async () => {
    const bad = VALID_LADDER.map((t) => (t.tier === 'fair' ? { ...t, min: 90 } : t)); // fair(90) > excellent(85)
    await expect(loanPolicyService.setGroupOverride(ctx, bad)).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a ladder whose lowest tier is not min=0 (would leave some scores unresolved)', async () => {
    const bad = VALID_LADDER.map((t) => (t.tier === 'high_risk' ? { ...t, min: 5 } : t));
    await expect(loanPolicyService.setGroupOverride(ctx, bad)).rejects.toBeInstanceOf(ValidationError);
  });

  it('accepts a valid ladder and writes it at group scope', async () => {
    await loanPolicyService.setGroupOverride(ctx, VALID_LADDER);
    expect(setPolicy).toHaveBeenCalledWith(mockClient, 'loan', 'tier_thresholds', { groupId: 'g1' }, VALID_LADDER, 'user-1');
  });
});

describe('loanPolicyService.setPlatformDefault', () => {
  it('validates and writes at platform scope (both org/group null)', async () => {
    await loanPolicyService.setPlatformDefault('admin-1', mockClient as never, VALID_LADDER);
    expect(setPolicy).toHaveBeenCalledWith(mockClient, 'loan', 'tier_thresholds', {}, VALID_LADDER, 'admin-1');
  });
});

/**
 * Term options (2026-08-16). Groups do not lend for "any length up to the
 * maximum" — they offer a handful of fixed durations (1, 3, 6, 12 months),
 * which maxTermMonths alone could not express.
 *
 * Unlike the rate, which stays advisory by long-standing product decision,
 * these are ENFORCED on loan application. That makes their validation load
 * bearing: a policy that lets an option exceed its own ceiling would have the
 * two halves contradicting each other.
 */
describe('loanPolicyService.setGroupTermsOverride — term options', () => {
  const VALID_TERMS = {
    interestRate: 10, interestMethod: 'flat' as const,
    maxTermMonths: 12, loanMultiplier: 3, termOptions: [1, 3, 6, 12],
  };

  it('accepts fixed durations within the ceiling', async () => {
    await loanPolicyService.setGroupTermsOverride(ctx as never, VALID_TERMS);
    expect(setPolicy).toHaveBeenCalledWith(
      mockClient, 'loan', 'terms', { groupId: 'g1' }, VALID_TERMS, 'user-1',
    );
  });

  it('rejects an option longer than maxTermMonths', async () => {
    // The contradiction that matters: offering 18 months under a 12-month cap.
    await expect(loanPolicyService.setGroupTermsOverride(
      ctx as never, { ...VALID_TERMS, termOptions: [1, 3, 18] },
    )).rejects.toBeInstanceOf(ValidationError);
    expect(setPolicy).not.toHaveBeenCalled();
  });

  it('rejects a repeated term', async () => {
    await expect(loanPolicyService.setGroupTermsOverride(
      ctx as never, { ...VALID_TERMS, termOptions: [3, 3, 6] },
    )).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a zero or fractional term', async () => {
    await expect(loanPolicyService.setGroupTermsOverride(
      ctx as never, { ...VALID_TERMS, termOptions: [0, 6] },
    )).rejects.toBeInstanceOf(ValidationError);
    await expect(loanPolicyService.setGroupTermsOverride(
      ctx as never, { ...VALID_TERMS, termOptions: [1.5, 6] },
    )).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an empty list, which would offer nothing at all', async () => {
    await expect(loanPolicyService.setGroupTermsOverride(
      ctx as never, { ...VALID_TERMS, termOptions: [] },
    )).rejects.toBeInstanceOf(ValidationError);
  });

  it('accepts terms with no options at all — any term up to the maximum', async () => {
    // Backwards compatibility: every policy stored before term options existed
    // has no termOptions key, and must keep resolving.
    const { termOptions: _omitted, ...withoutOptions } = VALID_TERMS;
    await loanPolicyService.setGroupTermsOverride(ctx as never, withoutOptions);
    expect(setPolicy).toHaveBeenCalled();
  });
});
