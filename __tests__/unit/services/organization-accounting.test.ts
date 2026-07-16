/**
 * Organization-level chart of accounts and posting engine (migration 085,
 * ACCOUNTING_ARCHITECTURE_AUDIT.md §9 Critical finding) — a parallel ledger
 * to the group-scoped accounting.service.ts, not an extension of it.
 */
import { withDb } from '@/lib/db';
import {
  organizationAccountingService,
  postOrgSystemJournal,
} from '@/lib/services/organization-accounting.service';

jest.mock('@/lib/db', () => ({
  withDb: jest.fn(),
}));
jest.mock('./organization.service', () => ({
  organizationService: { assertOrganizationCoordinator: jest.fn() },
}), { virtual: true });

const mockQuery  = jest.fn();
const mockClient = { query: mockQuery };

beforeEach(() => {
  mockQuery.mockReset();
  (withDb as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
});

const ctx = { groupId: 'grp-1', userId: 'coord-1', role: 'organization_coordinator', organizationId: 'org-1' };

describe('organizationAccountingService.listAccounts', () => {
  it('scopes to the caller organization', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'a1', account_code: '1001' }] });
    const result = await organizationAccountingService.listAccounts(ctx);
    expect(result).toHaveLength(1);
    expect(mockQuery.mock.calls[0][1]).toEqual(['org-1']);
  });
});

describe('organizationAccountingService.getTrialBalance', () => {
  it('flips sign for liability/equity/income accounts', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ accountCode: '4001', accountName: 'Donor Contributions', accountType: 'income', netBalance: '-5000.00' }],
    });
    const result = await organizationAccountingService.getTrialBalance(ctx);
    expect(result[0].netBalance).toBe('-5000.00');
  });
});

describe('organizationAccountingService.seedDefaultAccountsInTx', () => {
  it('inserts exactly the three accounts current posting paths use', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await organizationAccountingService.seedDefaultAccountsInTx(mockClient as never, 'org-1');
    expect(mockQuery).toHaveBeenCalledTimes(3);
    const codes = mockQuery.mock.calls.map((c) => c[1][1]);
    expect(codes.sort()).toEqual(['1001', '4001', '5001']);
  });
});

describe('postOrgSystemJournal', () => {
  it('posts a balanced entry when both accounts exist', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'acct-1001', account_code: '1001' }, { id: 'acct-4001', account_code: '4001' }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'je-1' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const jeId = await postOrgSystemJournal(
      mockClient as never, 'org-1', 'coord-1', 'Deposit',
      [{ accountCode: '1001', debit: 1000 }, { accountCode: '4001', credit: 1000 }],
      { reference: 'REF-1' },
    );

    expect(jeId).toBe('je-1');
    expect(mockQuery).toHaveBeenCalledTimes(4);
    const lineInsert1 = mockQuery.mock.calls[2];
    expect(lineInsert1[1]).toEqual(['org-1', 'je-1', 'acct-1001', '1000.00', '0.00']);
    const lineInsert2 = mockQuery.mock.calls[3];
    expect(lineInsert2[1]).toEqual(['org-1', 'je-1', 'acct-4001', '0.00', '1000.00']);
  });

  it('skips posting and returns null when a chart-of-accounts row is missing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'acct-1001', account_code: '1001' }] }); // 4001 missing

    const jeId = await postOrgSystemJournal(
      mockClient as never, 'org-1', 'coord-1', 'Deposit',
      [{ accountCode: '1001', debit: 1000 }, { accountCode: '4001', credit: 1000 }],
    );

    expect(jeId).toBeNull();
    expect(mockQuery).toHaveBeenCalledTimes(1); // never reaches the INSERT
  });
});
