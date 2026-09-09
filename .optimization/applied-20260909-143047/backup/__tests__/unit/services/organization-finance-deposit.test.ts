/**
 * organizationFinanceService.deposit — now also posts DR 1001 Cash and Bank /
 * CR 4001 Donor Contributions to the organization's own ledger (migration 085),
 * closing the gap where deposits only ever touched organization_wallets with
 * no GL trace (ACCOUNTING_ARCHITECTURE_AUDIT.md §9).
 */
import { withTransaction } from '@/lib/db';
import { organizationFinanceService } from '@/lib/services/organization-finance.service';
import { ValidationError } from '@/lib/utils/errors';

jest.mock('@/lib/db', () => ({
  withDb: jest.fn(),
  withTransaction: jest.fn(),
  withAdminDb: jest.fn(),
}));
jest.mock('./organization.service', () => ({
  organizationService: { assertOrganizationCoordinator: jest.fn() },
}), { virtual: true });

const mockQuery  = jest.fn();
const mockClient = { query: mockQuery };

beforeEach(() => {
  mockQuery.mockReset();
  (withTransaction as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
});

const ctx = { groupId: 'grp-1', userId: 'coord-1', role: 'organization_coordinator', organizationId: 'org-1' };

describe('organizationFinanceService.deposit', () => {
  it('rejects a non-positive amount before touching the database', async () => {
    await expect(organizationFinanceService.deposit(ctx, { amount: 0 }))
      .rejects.toBeInstanceOf(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('posts DR 1001 / CR 4001 to the organization ledger after recording the deposit', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'wallet-1', available_balance: '10000.00' }] }); // wallet lock
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'wallet-1', available_balance: '15000.00' }] }); // wallet UPDATE
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'ledger-1' }] });                                // organization_ledger INSERT
    mockQuery.mockResolvedValueOnce({                                                              // postOrgSystemJournal: accounts
      rows: [{ id: 'acct-1001', account_code: '1001' }, { id: 'acct-4001', account_code: '4001' }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'org-je-1' }] });                                // organization_journal_entries INSERT
    mockQuery.mockResolvedValueOnce({ rows: [] });                                                  // journal_lines INSERT (debit)
    mockQuery.mockResolvedValueOnce({ rows: [] });                                                  // journal_lines INSERT (credit)

    const result = await organizationFinanceService.deposit(ctx, { amount: 5000, source: 'World Bank' });

    expect(result.ledgerEntryId).toBe('ledger-1');
    expect(mockQuery).toHaveBeenCalledTimes(7);

    const acctsCall = mockQuery.mock.calls[3];
    expect(acctsCall[1]).toEqual(['org-1', ['1001', '4001']]);

    const debitLine  = mockQuery.mock.calls[5][1];
    const creditLine = mockQuery.mock.calls[6][1];
    expect(debitLine).toEqual(['org-1', 'org-je-1', 'acct-1001', '5000.00', '0.00']);
    expect(creditLine).toEqual(['org-1', 'org-je-1', 'acct-4001', '0.00', '5000.00']);
  });
});
