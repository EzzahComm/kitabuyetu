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

/**
 * disburse() → settleOrgDisbursement() → postOrgSystemJournal() is a deep
 * chain (~30 queries once every audit-log insert R11 added is counted), and
 * new audit logging has already broken a purely positional
 * mockResolvedValueOnce chain here once. Matching by SQL shape instead of
 * call order means a future audit-log addition anywhere in the chain can't
 * silently desync this test again — only the specific values a test asserts
 * on need to be named here; every other shape (mostly audit_logs INSERTs)
 * falls through to a safe generic default.
 */
function sqlRouter(threshold: number) {
  return async (sql: string): Promise<{ rows: unknown[] }> => {
    const s = sql.replace(/\s+/g, ' ').trim();

    if (/INSERT INTO audit_logs/.test(s)) return { rows: [] };

    if (/^SELECT id FROM organization_group_access/.test(s)) return { rows: [{ id: 'access-1' }] };

    if (/FROM organization_wallets[\s\S]*FOR UPDATE/.test(s)) {
      return { rows: [{ id: 'wallet-1', available_balance: '50000.00', committed_balance: '0.00' }] };
    }
    if (/UPDATE organization_wallets SET\s+available_balance = available_balance -/.test(s)) {
      return { rows: [{ id: 'wallet-1', available_balance: '45000.00', committed_balance: '5000.00' }] };
    }
    if (/UPDATE organization_wallets[\s\S]*committed_balance = committed_balance -/.test(s)) {
      return { rows: [{ available_balance: '50000.00', committed_balance: '0.00', total_disbursed: '5000.00' }] };
    }
    if (/FROM organization_wallets WHERE id = \$1/.test(s)) {
      return { rows: [{ available_balance: '45000.00', committed_balance: '5000.00', total_disbursed: '0.00' }] };
    }

    if (/FROM policies/.test(s)) {
      return { rows: [{ organization_id: 'org-1', group_id: null, value: { threshold } }] };
    }

    const needsApproval = input.amount > threshold;

    if (/INSERT INTO organization_disbursements/.test(s)) {
      return {
        rows: [{
          id: 'disb-1', organization_id: 'org-1', wallet_id: 'wallet-1', group_id: 'grp-1',
          funding_program_id: null, disbursement_type: 'grant', amount: '5000.00',
          reference: 'ODB-1', is_repayable: false, processing_fee_amount: '0.00',
          net_disbursed_amount: '5000.00',
          status: needsApproval ? 'pending_approval' : 'approved',
        }],
      };
    }
    if (/FROM organization_disbursements[\s\S]*FOR UPDATE/.test(s)) {
      return {
        rows: [{
          id: 'disb-1', organization_id: 'org-1', wallet_id: 'wallet-1', group_id: 'grp-1',
          funding_program_id: null, disbursement_type: 'grant', amount: '5000.00',
          reference: 'ODB-1', is_repayable: false, processing_fee_amount: '0.00',
          net_disbursed_amount: '5000.00',
        }],
      };
    }
    if (/SELECT status FROM organization_disbursements/.test(s)) return { rows: [{ status: 'approved' }] };
    if (/UPDATE organization_disbursements SET ledger_entry_id/.test(s)) return { rows: [] };
    if (/UPDATE organization_disbursements SET\s+status = 'completed'/.test(s)) return { rows: [] };
    if (/FROM organization_disbursements WHERE id = \$1/.test(s)) {
      return { rows: [{ id: 'disb-1', status: needsApproval ? 'pending_approval' : 'completed', amount: '5000.00' }] };
    }

    if (/INSERT INTO organization_ledger/.test(s)) return { rows: [{ id: 'ledger-1' }] };

    if (/FROM organizations o/.test(s)) return { rows: [{ org_name: 'Test Org', program_name: null }] };
    if (/FROM group_funding_sources/.test(s)) return { rows: [] };
    if (/INSERT INTO group_funding_sources/.test(s)) return { rows: [] };

    if (/FROM accounts\b/.test(s)) return { rows: [{ code: '1001', id: 'acct-cash' }, { code: '4005', id: 'acct-income' }] };
    if (/INSERT INTO journal_entries/.test(s)) return { rows: [{ id: 'je-1' }] };
    if (/INSERT INTO journal_lines/.test(s)) return { rows: [] };

    if (/FROM organization_accounts/.test(s)) {
      return { rows: [{ id: 'org-acct-5001', account_code: '5001' }, { id: 'org-acct-1001', account_code: '1001' }] };
    }
    if (/INSERT INTO organization_journal_entries/.test(s)) return { rows: [{ id: 'org-je-1' }] };
    if (/INSERT INTO organization_journal_lines/.test(s)) return { rows: [{ id: 'org-jl-1' }] };

    return { rows: [{}] };
  };
}

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
    mockQuery.mockImplementation(sqlRouter(20000)); // amount 5000 < threshold 20000

    const result = await organizationFinanceService.disburse(ctx, input);

    expect(result.needsApproval).toBe(false);
    expect(result.status).toBe('completed');
    // Reservation used committed_balance, not a bare debit.
    const reserveCall = mockQuery.mock.calls.find(
      ([sql]: [string]) => /available_balance\s*=\s*available_balance\s*-/.test(sql),
    );
    expect(reserveCall?.[0]).toContain('committed_balance');
  });

  it('parks pending_approval above the org threshold — no group journal posted', async () => {
    mockQuery.mockImplementation(sqlRouter(2000)); // amount 5000 > threshold 2000

    const result = await organizationFinanceService.disburse(ctx, input);

    expect(result.needsApproval).toBe(true);
    expect(result.status).toBe('pending_approval');
    // No settlement queries ran — the group-side journal is never posted
    // above the threshold.
    expect(mockQuery.mock.calls.some(([sql]: [string]) => /INSERT INTO journal_entries/.test(sql))).toBe(false);
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
    mockQuery.mockResolvedValueOnce({ rows: [{ available_balance: '50000.00', committed_balance: '0.00' }] }); // release UPDATE
    mockQuery.mockResolvedValueOnce({ rows: [] }); // audit log: wallet.release_reservation
    mockQuery.mockResolvedValueOnce({ rows: [] }); // ledger reversal INSERT
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'disb-2', status: 'rejected' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // audit log: disbursement.reject

    const result = await organizationFinanceService.rejectDisbursement(ctx, 'disb-2', 'budget cut');
    expect(result.status).toBe('rejected');
    expect(mockQuery.mock.calls[1][0]).toContain('committed_balance');
  });
});
