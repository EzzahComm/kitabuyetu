/**
 * ApprovalPolicy — first Configuration Service domain wired end-to-end
 * (ACCOUNTING_ARCHITECTURE_AUDIT.md §29.5). Unifies groups.journal_approval_threshold,
 * groups.disbursement_approval_threshold, and organizations.disbursement_approval_threshold
 * into one Platform -> Organization -> Group resolver. `journal_threshold` is
 * the one key with a DB trigger backstop (migration 081), so writes to it
 * also keep groups.journal_approval_threshold in sync — these tests verify
 * that sync fires only for that key, not the other two.
 */
import { withDb, withTransaction } from '@/lib/db';
import { resolvePolicy, resolvePolicyDetailed, setPolicy } from '@/lib/services/configuration.service';
import { approvalPolicyService, getEffectiveThreshold } from '@/lib/services/approval-policy.service';
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

const ctx    = { groupId: 'g1', userId: 'user-1', role: 'treasurer', organizationId: 'org-1' };
const orgCtx = { groupId: 'g1', userId: 'user-1', role: 'organization_coordinator', organizationId: 'org-1' };

describe('getEffectiveThreshold', () => {
  it('resolves via the generic engine with the domain-specific fallback', async () => {
    (resolvePolicy as jest.Mock).mockResolvedValueOnce({ threshold: 12000 });
    const value = await getEffectiveThreshold(mockClient as never, 'group_disbursement_threshold', { groupId: 'g1' });
    expect(value).toBe(12000);
    expect(resolvePolicy).toHaveBeenCalledWith(mockClient, 'approval', 'group_disbursement_threshold', { groupId: 'g1' }, { threshold: 20000 });
  });
});

describe('approvalPolicyService.getGroupPolicies', () => {
  it('resolves journal_threshold and group_disbursement_threshold scoped to the group', async () => {
    (resolvePolicyDetailed as jest.Mock)
      .mockResolvedValueOnce({ value: { threshold: 0 }, source: 'platform' })
      .mockResolvedValueOnce({ value: { threshold: 20000 }, source: 'platform' });

    const result = await approvalPolicyService.getGroupPolicies(ctx);

    expect(result).toEqual([
      { key: 'journal_threshold', threshold: 0, source: 'platform' },
      { key: 'group_disbursement_threshold', threshold: 20000, source: 'platform' },
    ]);
    expect(resolvePolicyDetailed).toHaveBeenNthCalledWith(1, mockClient, 'approval', 'journal_threshold', { groupId: 'g1' }, { threshold: 0 });
  });
});

describe('approvalPolicyService.setGroupOverride', () => {
  it('rejects org_disbursement_threshold — it has no group-level scope', async () => {
    await expect(approvalPolicyService.setGroupOverride(ctx, 'org_disbursement_threshold', 1000))
      .rejects.toBeInstanceOf(ValidationError);
    expect(setPolicy).not.toHaveBeenCalled();
  });

  it('rejects a negative threshold', async () => {
    await expect(approvalPolicyService.setGroupOverride(ctx, 'journal_threshold', -5))
      .rejects.toBeInstanceOf(ValidationError);
    expect(setPolicy).not.toHaveBeenCalled();
  });

  it('sets group_disbursement_threshold without touching the journal-threshold sync column', async () => {
    await approvalPolicyService.setGroupOverride(ctx, 'group_disbursement_threshold', 15000);

    expect(setPolicy).toHaveBeenCalledWith(mockClient, 'approval', 'group_disbursement_threshold', { groupId: 'g1' }, { threshold: 15000 }, 'user-1');
    expect(mockQuery).not.toHaveBeenCalled(); // no groups.journal_approval_threshold UPDATE
  });

  it('sets journal_threshold and syncs groups.journal_approval_threshold (DB trigger backstop)', async () => {
    (resolvePolicy as jest.Mock).mockResolvedValueOnce({ threshold: 8000 }); // effective value after the write

    await approvalPolicyService.setGroupOverride(ctx, 'journal_threshold', 8000);

    expect(setPolicy).toHaveBeenCalledWith(mockClient, 'approval', 'journal_threshold', { groupId: 'g1' }, { threshold: 8000 }, 'user-1');
    expect(mockQuery).toHaveBeenCalledWith(
      `UPDATE groups SET journal_approval_threshold = $1 WHERE id = $2`,
      ['8000.00', 'g1'],
    );
  });
});

describe('approvalPolicyService.setOrganizationOverride', () => {
  it('sets org_disbursement_threshold scoped to the organization, no group sync needed', async () => {
    await approvalPolicyService.setOrganizationOverride(orgCtx, 'org_disbursement_threshold', 60000);

    expect(setPolicy).toHaveBeenCalledWith(mockClient, 'approval', 'org_disbursement_threshold', { organizationId: 'org-1' }, { threshold: 60000 }, 'user-1');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('sets journal_threshold at organization scope and syncs every linked group without its own override', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'g1' }, { id: 'g2' }] }); // groups linked to org without an override
    (resolvePolicy as jest.Mock)
      .mockResolvedValueOnce({ threshold: 5000 }) // g1
      .mockResolvedValueOnce({ threshold: 5000 }); // g2

    await approvalPolicyService.setOrganizationOverride(orgCtx, 'journal_threshold', 5000);

    expect(setPolicy).toHaveBeenCalledWith(mockClient, 'approval', 'journal_threshold', { organizationId: 'org-1' }, { threshold: 5000 }, 'user-1');
    // one UPDATE per affected group
    const updateCalls = mockQuery.mock.calls.filter((c) => String(c[0]).includes('UPDATE groups'));
    expect(updateCalls).toHaveLength(2);
  });
});
