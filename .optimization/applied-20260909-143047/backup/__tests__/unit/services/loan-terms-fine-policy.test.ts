/**
 * LoanPolicy 'terms' + FinePolicy 'schedule' — the policy domains migrated
 * from the retired group_constitutions table (migration 088, audit §33.1).
 * Advisory values: nothing here enforces lending, so validation is the whole
 * safety surface.
 */
import { withDb, withTransaction } from '@/lib/db';
import { resolvePolicy, resolvePolicyDetailed, setPolicy } from '@/lib/services/configuration.service';
import { loanPolicyService, getEffectiveLoanTerms, type LoanTerms } from '@/lib/services/loan-policy.service';
import { finePolicyService } from '@/lib/services/fine-policy.service';
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

const VALID_TERMS: LoanTerms = {
  interestRate: 10, interestMethod: 'flat', maxTermMonths: 12, loanMultiplier: 3,
};

describe('getEffectiveLoanTerms', () => {
  it('resolves via the generic engine under the loan/terms key', async () => {
    (resolvePolicy as jest.Mock).mockResolvedValueOnce(VALID_TERMS);
    const result = await getEffectiveLoanTerms(mockClient as never, { groupId: 'g1' });
    expect(result).toEqual(VALID_TERMS);
    expect(resolvePolicy).toHaveBeenCalledWith(mockClient, 'loan', 'terms', { groupId: 'g1' }, expect.any(Object));
  });
});

describe('loanPolicyService.setGroupTermsOverride', () => {
  it('rejects an interest rate above 100', async () => {
    await expect(loanPolicyService.setGroupTermsOverride(ctx, { ...VALID_TERMS, interestRate: 101 }))
      .rejects.toBeInstanceOf(ValidationError);
    expect(setPolicy).not.toHaveBeenCalled();
  });

  it('rejects an unknown interest method', async () => {
    await expect(loanPolicyService.setGroupTermsOverride(ctx, { ...VALID_TERMS, interestMethod: 'compound' as never }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a fractional or out-of-range max term', async () => {
    await expect(loanPolicyService.setGroupTermsOverride(ctx, { ...VALID_TERMS, maxTermMonths: 6.5 }))
      .rejects.toBeInstanceOf(ValidationError);
    await expect(loanPolicyService.setGroupTermsOverride(ctx, { ...VALID_TERMS, maxTermMonths: 0 }))
      .rejects.toBeInstanceOf(ValidationError);
    await expect(loanPolicyService.setGroupTermsOverride(ctx, { ...VALID_TERMS, maxTermMonths: 121 }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a non-positive loan multiplier', async () => {
    await expect(loanPolicyService.setGroupTermsOverride(ctx, { ...VALID_TERMS, loanMultiplier: 0 }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('accepts valid terms and writes them at group scope', async () => {
    await loanPolicyService.setGroupTermsOverride(ctx, VALID_TERMS);
    expect(setPolicy).toHaveBeenCalledWith(mockClient, 'loan', 'terms', { groupId: 'g1' }, VALID_TERMS, 'user-1');
  });
});

describe('loanPolicyService.getGroupTerms', () => {
  it('returns resolved terms with provenance', async () => {
    (resolvePolicyDetailed as jest.Mock).mockResolvedValueOnce({ value: VALID_TERMS, source: 'organization' });
    const result = await loanPolicyService.getGroupTerms(ctx);
    expect(result).toEqual({ terms: VALID_TERMS, source: 'organization' });
  });
});

describe('finePolicyService.setGroupOverride', () => {
  it('rejects an empty schedule', async () => {
    await expect(finePolicyService.setGroupOverride(ctx, {})).rejects.toBeInstanceOf(ValidationError);
    expect(setPolicy).not.toHaveBeenCalled();
  });

  it('rejects a negative amount', async () => {
    await expect(finePolicyService.setGroupOverride(ctx, { absence: -5 })).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a blank category name', async () => {
    await expect(finePolicyService.setGroupOverride(ctx, { '  ': 50 })).rejects.toBeInstanceOf(ValidationError);
  });

  it('accepts a valid schedule and writes it at group scope', async () => {
    const schedule = { late_attendance: 50, absence: 100, misconduct: 200 };
    await finePolicyService.setGroupOverride(ctx, schedule);
    expect(setPolicy).toHaveBeenCalledWith(mockClient, 'fine', 'schedule', { groupId: 'g1' }, schedule, 'user-1');
  });
});
