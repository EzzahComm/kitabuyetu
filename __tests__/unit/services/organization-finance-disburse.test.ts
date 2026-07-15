/**
 * Org -> group disbursement dual control — closes B2B_ENTERPRISE_AUDIT.md
 * Critical Issue #4 (no separation of duties): amounts above the org's
 * threshold reserve funds via committed_balance and park pending_approval;
 * a different coordinator must approve before the group journal posts.
 */
import { withDb, withTransaction, withAdminDb } from '@/lib/db';
import { organizationFinanceService } from '@/lib/services/organization-finance.service';
import { ValidationError, ForbiddenError, NotFoundError } from '@/lib/utils/errors';

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
  (withDb as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
  (withTransaction as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
  (withAdminDb as jest.Mock).mockImplementation((fn) => fn(mockClient));
});

const ctx = { groupId: 'grp-1', userId: 'coord-1', role: 'organization_coordinator', organizationId: 'org-1' };

const input = { groupId: 'grp-1', amount: 5000, disbursementType: 'grant' as const };

describe('organizationFinanceService.disburse', () => {
  it('rejects insufficient wallet balance', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'access-1' }] });               // group link
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'wallet-1', available_balance: '1000.00' }] }); // wallet lock

    await expect(organizationFinanceService.disburse(ctx, input))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('throws NotFoundError when the group has no active org link', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(organizationFinanceService.disburse(ctx, input))
      .rejects.toBeInstanceOf(NotFoundError);
  });

  it('settles immediately under the org threshold', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'access-1' }] });                        // group link
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'wallet-1', available_balance: '50000.00' }] }); // wallet lock
    mockQuery.mockResolvedValueOnce({ rows: [{ threshold: '20000.00' }] });                 // org threshold (high)
    mockQuery.mockResolvedValueOnce({ rows: [] });                                          // reserve UPDATE
    mockQuery.mockResolvedValueOnce({                                                       // INSERT disbursement
      rows: [{ id: 'disb-1', status: 'approved', wallet_id: 'wallet-1', amount: '5000.00' }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'ledger-1' }] });                         // ledger INSERT
    mockQuery.mockResolvedValueOnce({ rows: [] });                                          // ledger_entry_id UPDATE
    // settleOrgDisbursement (withAdminDb):
    mockQuery.mockResolvedValueOnce({                                                       // SELECT ... FOR UPDATE
      rows: [{
        id: 'disb-1', organization_id: 'org-1', wallet_id: 'wallet-1', group_id: 'grp-1',
        funding_program_id: null, disbursement_type: 'grant', amount: '5000.00', reference: 'ODB-1',
      }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ code: '1001', id: 'acct-cash' }, { code: '4005', id: 'acct-income' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'je-1' }] });                             // journal_entries INSERT
    mockQuery.mockResolvedValueOnce({ rows: [] });                                          // journal_lines INSERT
    mockQuery.mockResolvedValueOnce({ rows: [] });                                          // wallet settle UPDATE
    mockQuery.mockResolvedValueOnce({ rows: [] });                                          // disbursement status UPDATE
    mockQuery.mockResolvedValueOnce({                                                       // final fetch
      rows: [{ id: 'disb-1', status: 'completed', amount: '5000.00' }],
    });

    const result = await organizationFinanceService.disburse(ctx, input);

    expect(result.needsApproval).toBe(false);
    expect(result.status).toBe('completed');
    // Reservation used committed_balance, not a bare debit.
    const reserveCall = mockQuery.mock.calls[3][0];
    expect(reserveCall).toContain('committed_balance');
  });

  it('parks pending_approval above the org threshold — no group journal posted', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'access-1' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'wallet-1', available_balance: '50000.00' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ threshold: '2000.00' }] }); // low threshold
    mockQuery.mockResolvedValueOnce({ rows: [] });                        // reserve UPDATE
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'disb-2', status: 'pending_approval', wallet_id: 'wallet-1', amount: '5000.00' }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'ledger-2' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ // final fetch — no settlement queries follow
      rows: [{ id: 'disb-2', status: 'pending_approval', amount: '5000.00' }],
    });

    const result = await organizationFinanceService.disburse(ctx, input);

    expect(result.needsApproval).toBe(true);
    expect(result.status).toBe('pending_approval');
    // 8 queries total: no settlement (journal/wallet-settle) queries ran.
    expect(mockQuery).toHaveBeenCalledTimes(8);
  });
});

describe('organizationFinanceService.approveDisbursement', () => {
  it('refuses approval by the same coordinator who created it (maker-checker)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'disb-2', created_by: 'coord-1' }] });
    await expect(organizationFinanceService.approveDisbursement(ctx, 'disb-2'))
      .rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('organizationFinanceService.rejectDisbursement', () => {
  it('releases the wallet reservation via committed_balance', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ wallet_id: 'wallet-1', amount: '5000.00' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ available_balance: '50000.00' }] }); // release UPDATE
    mockQuery.mockResolvedValueOnce({ rows: [] }); // ledger reversal INSERT
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'disb-2', status: 'rejected' }] });

    const result = await organizationFinanceService.rejectDisbursement(ctx, 'disb-2', 'budget cut');
    expect(result.status).toBe('rejected');
    expect(mockQuery.mock.calls[1][0]).toContain('committed_balance');
  });
});
