/**
 * SavingsPolicy 'limits' — a new Configuration Service domain
 * (ACCOUNTING_ARCHITECTURE_AUDIT.md §29.5/§33.5), with no prior hardcoded
 * constant to migrate (§22 found min/max contribution and grace period
 * simply didn't exist). Advisory only: nothing here enforces contributions,
 * so validation is the whole safety surface.
 */
import { withDb, withTransaction } from '@/lib/db';
import { resolvePolicy, resolvePolicyDetailed, setPolicy } from '@/lib/services/configuration.service';
import {
  savingsPolicyService, getEffectiveSavingsLimits, type SavingsLimits,
} from '@/lib/services/savings-policy.service';
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

const ctx = { groupId: 'g1', userId: 'user-1', role: 'treasurer', organizationId: 'org-1' };

const VALID_LIMITS: SavingsLimits = { minContribution: 200, maxContribution: 5000, gracePeriodDays: 7 };

describe('getEffectiveSavingsLimits', () => {
  it('resolves via the generic engine under the savings/limits key', async () => {
    (resolvePolicy as jest.Mock).mockResolvedValueOnce(VALID_LIMITS);
    const result = await getEffectiveSavingsLimits(mockClient as never, { groupId: 'g1' });
    expect(result).toEqual(VALID_LIMITS);
    expect(resolvePolicy).toHaveBeenCalledWith(mockClient, 'savings', 'limits', { groupId: 'g1' }, expect.any(Object));
  });
});

describe('savingsPolicyService.setGroupLimitsOverride', () => {
  it('rejects a negative minContribution', async () => {
    await expect(savingsPolicyService.setGroupLimitsOverride(ctx, { ...VALID_LIMITS, minContribution: -1 }))
      .rejects.toBeInstanceOf(ValidationError);
    expect(setPolicy).not.toHaveBeenCalled();
  });

  it('rejects a maxContribution that is not greater than minContribution', async () => {
    await expect(savingsPolicyService.setGroupLimitsOverride(ctx, { minContribution: 500, maxContribution: 500, gracePeriodDays: 0 }))
      .rejects.toBeInstanceOf(ValidationError);
    await expect(savingsPolicyService.setGroupLimitsOverride(ctx, { minContribution: 500, maxContribution: 100, gracePeriodDays: 0 }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('accepts a null maxContribution (no maximum)', async () => {
    await savingsPolicyService.setGroupLimitsOverride(ctx, { minContribution: 0, maxContribution: null, gracePeriodDays: 0 });
    expect(setPolicy).toHaveBeenCalledWith(
      mockClient, 'savings', 'limits', { groupId: 'g1' },
      { minContribution: 0, maxContribution: null, gracePeriodDays: 0 }, 'user-1',
    );
  });

  it('rejects a fractional or negative gracePeriodDays', async () => {
    await expect(savingsPolicyService.setGroupLimitsOverride(ctx, { ...VALID_LIMITS, gracePeriodDays: 2.5 }))
      .rejects.toBeInstanceOf(ValidationError);
    await expect(savingsPolicyService.setGroupLimitsOverride(ctx, { ...VALID_LIMITS, gracePeriodDays: -1 }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('accepts valid limits and writes them at group scope', async () => {
    await savingsPolicyService.setGroupLimitsOverride(ctx, VALID_LIMITS);
    expect(setPolicy).toHaveBeenCalledWith(mockClient, 'savings', 'limits', { groupId: 'g1' }, VALID_LIMITS, 'user-1');
  });
});

describe('savingsPolicyService.getGroupLimits', () => {
  it('returns resolved limits with provenance', async () => {
    (resolvePolicyDetailed as jest.Mock).mockResolvedValueOnce({ value: VALID_LIMITS, source: 'organization' });
    const result = await savingsPolicyService.getGroupLimits(ctx);
    expect(result).toEqual({ limits: VALID_LIMITS, source: 'organization' });
  });
});
