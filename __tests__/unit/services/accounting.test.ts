/**
 * Tests for the pure aggregation logic in accountingService.getProfitAndLoss.
 * DB queries are mocked so we're validating the sign convention fix:
 *   income accounts  → credit - debit  (returns positive total for credit-normal)
 *   expense accounts → debit - credit  (returns positive total for debit-normal)
 * And that netProfit = totalIncome - totalExpenses.
 */
import { withDb, withTransaction, withAdminDb } from '@/lib/db';
import {
  accountingService, reconcileGLCashToMpesaBalance, postSystemJournal,
  postContributionJournal, postLoanDisbursementJournal, postLoanRepaymentJournal,
} from '@/lib/services/accounting.service';
import { ForbiddenError, NotFoundError } from '@/lib/utils/errors';

jest.mock('@/lib/db', () => ({
  withDb: jest.fn(),
  withTransaction: jest.fn(),
  withAdminDb: jest.fn(),
}));

const mockQuery  = jest.fn();
const mockClient = { query: mockQuery };

beforeEach(() => {
  mockQuery.mockReset();
  (withDb as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
  (withTransaction as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
  (withAdminDb as jest.Mock).mockImplementation((fn) => fn(mockClient));
});

const ctx = { groupId: 'group-1', userId: 'user-1', role: 'treasurer' };

describe('getProfitAndLoss', () => {
  it('computes correct totals and netProfit when profitable', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { account_code: '4001', account_name: 'Contributions',   type: 'income',  total: '50000.00' },
        { account_code: '4002', account_name: 'Interest Income', type: 'income',  total: '8000.00'  },
        { account_code: '5001', account_name: 'Admin Expenses',  type: 'expense', total: '5000.00'  },
        { account_code: '5002', account_name: 'SMS Expenses',    type: 'expense', total: '1500.00'  },
      ],
    });

    const result = await accountingService.getProfitAndLoss(ctx, '2025-01-01', '2025-12-31');

    expect(result.totalIncome).toBe('58000.00');
    expect(result.totalExpenses).toBe('6500.00');
    expect(result.netProfit).toBe('51500.00');
    expect(result.income).toHaveLength(2);
    expect(result.expenses).toHaveLength(2);
  });

  it('returns zero net profit when income equals expenses', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { account_code: '4001', account_name: 'Contributions', type: 'income',  total: '10000.00' },
        { account_code: '5001', account_name: 'Admin',         type: 'expense', total: '10000.00' },
      ],
    });

    const result = await accountingService.getProfitAndLoss(ctx, '2025-01-01', '2025-12-31');
    expect(result.netProfit).toBe('0.00');
  });

  it('returns negative net profit (loss) when expenses exceed income', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { account_code: '4001', account_name: 'Contributions', type: 'income',  total: '5000.00' },
        { account_code: '5001', account_name: 'Admin',         type: 'expense', total: '8000.00' },
      ],
    });

    const result = await accountingService.getProfitAndLoss(ctx, '2025-01-01', '2025-12-31');
    expect(result.netProfit).toBe('-3000.00');
  });

  it('handles zero-activity period (all totals are zero)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { account_code: '4001', account_name: 'Contributions', type: 'income',  total: '0.00' },
        { account_code: '5001', account_name: 'Admin',         type: 'expense', total: '0.00' },
      ],
    });

    const result = await accountingService.getProfitAndLoss(ctx, '2025-01-01', '2025-01-31');
    expect(result.totalIncome).toBe('0.00');
    expect(result.totalExpenses).toBe('0.00');
    expect(result.netProfit).toBe('0.00');
  });

  it('returns empty arrays when no accounts have activity', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await accountingService.getProfitAndLoss(ctx, '2025-01-01', '2025-12-31');
    expect(result.income).toEqual([]);
    expect(result.expenses).toEqual([]);
    expect(result.netProfit).toBe('0.00');
  });

  it('sets period correctly from arguments', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await accountingService.getProfitAndLoss(ctx, '2025-04-01', '2025-06-30');
    expect(result.period.from).toBe('2025-04-01');
    expect(result.period.to).toBe('2025-06-30');
  });

  // ACCOUNTING_ARCHITECTURE_AUDIT.md §17/§19 — this query used to put its
  // status/date filter inside the journal_entries LEFT JOIN's ON clause,
  // which does not exclude jl rows from the SUM (only nulls je's own
  // columns) — silently summing every line ever posted for an account,
  // any status, any period. Pin both fixes so neither regresses:
  //  1. FILTER (WHERE je.status='posted' AND je.entry_date BETWEEN ...)
  //     actually gates the SUM.
  //  2. A redundant jl.entry_date predicate exists so the new
  //     idx_journal_lines_account_entry_date index can be used.
  it('filters posted status and period via FILTER, not the join condition, and predicates jl.entry_date directly', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await accountingService.getProfitAndLoss(ctx, '2025-04-01', '2025-06-30');

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/SUM\(jl\.debit\)\s+FILTER\s+\(WHERE je\.status = 'posted' AND je\.entry_date BETWEEN \$2 AND \$3\)/);
    expect(sql).toMatch(/SUM\(jl\.credit\)\s+FILTER\s+\(WHERE je\.status = 'posted' AND je\.entry_date BETWEEN \$2 AND \$3\)/);
    expect(sql).toContain('jl.entry_date BETWEEN $2 AND $3');
    // journal_entries join must carry no status/date condition of its own anymore.
    expect(sql).toMatch(/LEFT JOIN journal_entries je ON je\.id = jl\.journal_entry_id\s+WHERE/);
  });
});

// ACCOUNTING_ARCHITECTURE_AUDIT.md §15 — manual journal maker-checker.
// The DB trigger (migration 081) is the authoritative backstop; these tests
// cover the application-level check that surfaces a clean ForbiddenError
// instead of a raw constraint violation.
describe('postJournalEntry maker-checker', () => {
  it('blocks the creator from posting their own entry above the threshold', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'je-1', created_by: 'user-1', group_id: 'group-1', status: 'draft' }] })
      .mockResolvedValueOnce({ rows: [{ organization_id: null, group_id: 'group-1', value: { threshold: 1000 } }] })
      .mockResolvedValueOnce({ rows: [{ total: '5000.00' }] });

    await expect(accountingService.postJournalEntry(ctx, 'je-1')).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockQuery).toHaveBeenCalledTimes(3); // never reaches the UPDATE or audit-log insert
  });

  it('allows the creator to post their own entry at or under the threshold', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'je-1', created_by: 'user-1', group_id: 'group-1', status: 'draft' }] })
      .mockResolvedValueOnce({ rows: [{ organization_id: null, group_id: 'group-1', value: { threshold: 10000 } }] })
      .mockResolvedValueOnce({ rows: [{ total: '500.00' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'je-1', status: 'posted', posted_by: 'user-1' }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await accountingService.postJournalEntry(ctx, 'je-1');
    expect(result.status).toBe('posted');
    expect(mockQuery).toHaveBeenCalledTimes(5);
  });

  it('allows a different actor to post regardless of amount, without a threshold check', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'je-1', created_by: 'user-2', group_id: 'group-1', status: 'draft' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'je-1', status: 'posted', posted_by: 'user-1' }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await accountingService.postJournalEntry(ctx, 'je-1');
    expect(result.status).toBe('posted');
    expect(mockQuery).toHaveBeenCalledTimes(3); // no threshold lookup — different actor, no check needed
  });

  it('throws NotFoundError when there is no matching draft entry', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(accountingService.postJournalEntry(ctx, 'nope')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('voidJournalEntry maker-checker', () => {
  const voidInput = { reason: 'Duplicate entry, correcting' };

  it('blocks the poster from voiding their own entry above the threshold', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'je-1', posted_by: 'user-1', group_id: 'group-1', status: 'posted' }] })
      .mockResolvedValueOnce({ rows: [{ organization_id: null, group_id: 'group-1', value: { threshold: 1000 } }] })
      .mockResolvedValueOnce({ rows: [{ total: '5000.00' }] });

    await expect(accountingService.voidJournalEntry(ctx, 'je-1', voidInput)).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  it('allows a different actor to void regardless of amount', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'je-1', posted_by: 'user-2', group_id: 'group-1', status: 'posted' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'je-1', status: 'void' }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await accountingService.voidJournalEntry(ctx, 'je-1', voidInput);
    expect(result.status).toBe('void');
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });
});

// ACCOUNTING_ARCHITECTURE_AUDIT.md §7/§10/§29.9 — the shared posting point
// used to wire Shares/Welfare/Dividends/Subscriptions into the GL, since
// each call site's correctness hinges entirely on this function.
describe('postSystemJournal', () => {
  it('posts a balanced entry when both accounts exist', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'acct-cash', account_code: '1001' }, { id: 'acct-equity', account_code: '3001' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'je-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await postSystemJournal(
      mockClient as any, 'group-1', 'user-1', 'Share purchase',
      [{ accountCode: '1001', debit: 1000 }, { accountCode: '3001', credit: 1000 }],
    );

    expect(result).toBe('je-1');
    expect(mockQuery).toHaveBeenCalledTimes(4); // account lookup + journal insert + 2 line inserts

    const journalInsert = mockQuery.mock.calls[1];
    expect(journalInsert[0]).toContain(`INSERT INTO journal_entries`);
    expect(journalInsert[0]).toContain(`'posted'`);

    const line1 = mockQuery.mock.calls[2];
    expect(line1[1]).toEqual(['group-1', 'je-1', 'acct-cash', '1000.00', '0.00']);
    const line2 = mockQuery.mock.calls[3];
    expect(line2[1]).toEqual(['group-1', 'je-1', 'acct-equity', '0.00', '1000.00']);
  });

  it('posts a 3-line entry (dividend gross split into net + tax)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [
        { id: 'acct-surplus', account_code: '3101' },
        { id: 'acct-payable', account_code: '2103' },
        { id: 'acct-tax', account_code: '2104' },
      ] })
      .mockResolvedValueOnce({ rows: [{ id: 'je-2' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await postSystemJournal(
      mockClient as any, 'group-1', 'user-1', 'Dividend declaration approved',
      [
        { accountCode: '3101', debit: 1000 },
        { accountCode: '2103', credit: 850 },
        { accountCode: '2104', credit: 150 },
      ],
    );
    expect(result).toBe('je-2');
    expect(mockQuery).toHaveBeenCalledTimes(5); // account lookup + journal insert + 3 line inserts
  });

  it('skips posting and returns null when a chart-of-accounts row is missing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'acct-cash', account_code: '1001' }] }); // 2102 missing

    const result = await postSystemJournal(
      mockClient as any, 'group-1', 'user-1', 'Welfare pool contribution',
      [{ accountCode: '1001', debit: 500 }, { accountCode: '2102', credit: 500 }],
    );

    expect(result).toBeNull();
    expect(mockQuery).toHaveBeenCalledTimes(1); // never reaches the INSERTs
  });

  it('allows a null userId for system-posted entries (no authenticated actor)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'acct-cash', account_code: '1001' }, { id: 'acct-sub', account_code: '5003' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'je-3' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await postSystemJournal(
      mockClient as any, 'group-1', null, 'Platform subscription payment',
      [{ accountCode: '5003', debit: 500 }, { accountCode: '1001', credit: 500 }],
    );
    const journalInsert = mockQuery.mock.calls[1];
    expect(journalInsert[1]).toContain(null); // created_by
  });
});

// ACCOUNTING_ARCHITECTURE_AUDIT.md §6/§7 — the unified contribution/loan
// posting functions that replaced the six independently-written raw-SQL
// implementations across contributions.service.ts, loans.service.ts, and
// mpesa.service.ts. Highest-risk change of the audit's implementation, since
// it touches already-working, live money-movement code — covered in detail.
describe('postContributionJournal', () => {
  it('posts 100% to the default income account when no split rules are configured', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // loadActiveSplitRules — none configured
      .mockResolvedValueOnce({ rows: [{ code: '1001', id: 'acct-cash' }, { code: '4001', id: 'acct-4001' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'je-1' }] })
      .mockResolvedValueOnce({ rows: [] }) // cash debit line
      .mockResolvedValueOnce({ rows: [] }) // credit line (4001)
      .mockResolvedValueOnce({ rows: [] }); // UPDATE contributions.journal_entry_id

    const result = await postContributionJournal(mockClient as any, {
      groupId: 'group-1', contributionId: 'contrib-1', amount: 1000,
      entryDate: '2026-01-15', createdBy: 'user-1',
    });

    expect(result).toBe('je-1');
    const creditLine = mockQuery.mock.calls[4];
    expect(creditLine[1]).toEqual(['group-1', 'je-1', 'acct-4001', '1000.00']);
  });

  it('splits the credit side across configured income accounts', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ account_code: '2101', percentage: '80', fixed_amount: null, priority: 100 }] })
      .mockResolvedValueOnce({ rows: [
        { code: '1001', id: 'acct-cash' }, { code: '4001', id: 'acct-4001' }, { code: '2101', id: 'acct-2101' },
      ] })
      .mockResolvedValueOnce({ rows: [{ id: 'je-2' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await postContributionJournal(mockClient as any, {
      groupId: 'group-1', contributionId: 'contrib-2', amount: 1000,
      entryDate: '2026-01-15', createdBy: null, isTest: true,
    });

    expect(result).toBe('je-2');
    // DR cash 1000 + CR 2101 (800, 80%) + CR 4001 (200, remainder) = 2 credit lines + 1 debit line
    expect(mockQuery).toHaveBeenCalledTimes(7);
  });

  it('returns null and does not post when the cash account is missing', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ code: '4001', id: 'acct-4001' }] }); // no 1001

    const result = await postContributionJournal(mockClient as any, {
      groupId: 'group-1', contributionId: 'contrib-3', amount: 500,
      entryDate: '2026-01-15', createdBy: 'user-1',
    });

    expect(result).toBeNull();
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('returns null (amount <= 0 guard) after checking split rules but before any posting', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // loadActiveSplitRules
    const result = await postContributionJournal(mockClient as any, {
      groupId: 'group-1', contributionId: 'contrib-4', amount: 0,
      entryDate: '2026-01-15', createdBy: 'user-1',
    });
    expect(result).toBeNull();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe('postLoanDisbursementJournal', () => {
  it('posts a 2-line entry (no charge)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ code: '1001', id: 'acct-cash' }, { code: '1101', id: 'acct-recv' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'je-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await postLoanDisbursementJournal(mockClient as any, {
      groupId: 'group-1', loanId: 'loan-1', principal: 50000,
      entryDate: '2026-01-15', createdBy: 'user-1',
    });

    expect(result).toEqual({ journalEntryId: 'je-1', chargePosted: false });
    const line = mockQuery.mock.calls[2];
    expect(line[1]).toEqual(['group-1', 'je-1', 'acct-recv', '50000.00', 'acct-cash', '50000.00']);
  });

  it('folds the Safaricom fee in as a third line when a charge and expense account both exist', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [
        { code: '1001', id: 'acct-cash' }, { code: '1101', id: 'acct-recv' }, { code: '5001', id: 'acct-expense' },
      ] })
      .mockResolvedValueOnce({ rows: [{ id: 'je-2' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await postLoanDisbursementJournal(mockClient as any, {
      groupId: 'group-1', loanId: 'loan-2', principal: 50000, charge: 55,
      entryDate: '2026-01-15', createdBy: null, isTest: true,
    });

    expect(result).toEqual({ journalEntryId: 'je-2', chargePosted: true });
    const principalLine = mockQuery.mock.calls[2];
    expect(principalLine[1]).toEqual(['group-1', 'je-2', 'acct-recv', '50000.00', 'acct-cash', '50055.00']);
    const chargeLine = mockQuery.mock.calls[3];
    expect(chargeLine[1]).toEqual(['group-1', 'je-2', 'acct-expense', '55.00']);
  });

  it('falls back to principal-only when a charge exists but the expense account does not', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ code: '1001', id: 'acct-cash' }, { code: '1101', id: 'acct-recv' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'je-3' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await postLoanDisbursementJournal(mockClient as any, {
      groupId: 'group-1', loanId: 'loan-3', principal: 50000, charge: 55,
      entryDate: '2026-01-15', createdBy: 'user-1',
    });

    expect(result).toEqual({ journalEntryId: 'je-3', chargePosted: false });
    expect(mockQuery).toHaveBeenCalledTimes(4); // no third line posted for the fee
  });

  it('returns null when the chart of accounts is missing 1001/1101', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ code: '1001', id: 'acct-cash' }] });
    const result = await postLoanDisbursementJournal(mockClient as any, {
      groupId: 'group-1', loanId: 'loan-4', principal: 50000,
      entryDate: '2026-01-15', createdBy: 'user-1',
    });
    expect(result).toBeNull();
  });
});

describe('postLoanRepaymentJournal', () => {
  it('posts a 3-line entry when there is an interest portion', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [
        { code: '1001', id: 'acct-cash' }, { code: '1101', id: 'acct-recv' }, { code: '4002', id: 'acct-int' },
      ] })
      .mockResolvedValueOnce({ rows: [{ id: 'je-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await postLoanRepaymentJournal(mockClient as any, {
      groupId: 'group-1', repaymentId: 'rep-1', loanId: 'loan-1',
      principalPortion: 4000, interestPortion: 500,
      entryDate: '2026-01-15', createdBy: 'user-1',
    });

    expect(result).toBe('je-1');
    expect(mockQuery).toHaveBeenCalledTimes(6); // lookup + insert + 3 lines + update
    const cashLine = mockQuery.mock.calls[2];
    expect(cashLine[1]).toEqual(['group-1', 'je-1', 'acct-cash', '4500.00', '0.00']);
  });

  it('omits the interest line entirely when interestPortion is zero', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ code: '1001', id: 'acct-cash' }, { code: '1101', id: 'acct-recv' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'je-2' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await postLoanRepaymentJournal(mockClient as any, {
      groupId: 'group-1', repaymentId: 'rep-2', loanId: 'loan-2',
      principalPortion: 4500, interestPortion: 0,
      entryDate: '2026-01-15', createdBy: null, isTest: true,
    });

    expect(result).toBe('je-2');
    expect(mockQuery).toHaveBeenCalledTimes(5); // no interest line
  });

  it('returns null when an interest portion is due but 4002 is missing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ code: '1001', id: 'acct-cash' }, { code: '1101', id: 'acct-recv' }] });
    const result = await postLoanRepaymentJournal(mockClient as any, {
      groupId: 'group-1', repaymentId: 'rep-3', loanId: 'loan-3',
      principalPortion: 4000, interestPortion: 500,
      entryDate: '2026-01-15', createdBy: 'user-1',
    });
    expect(result).toBeNull();
  });
});

// ACCOUNTING_ARCHITECTURE_AUDIT.md §16 — GL-to-real-cash reconciliation.
describe('reconcileGLCashToMpesaBalance', () => {
  const rawResponse = (working: number, utility: number) => ({
    Result: {
      ResultParameters: {
        ResultParameter: [
          { Key: 'WorkingAccountAvailableFunds', Value: working },
          { Key: 'UtilityAccountAvailableFunds', Value: utility },
        ],
      },
    },
  });

  it('reports no_snapshot when no balance query has ever completed', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await reconcileGLCashToMpesaBalance();
    expect(result.status).toBe('no_snapshot');
  });

  it('reports stale_snapshot when the latest snapshot is too old', async () => {
    const oldDate = new Date(Date.now() - 48 * 3_600_000).toISOString();
    mockQuery.mockResolvedValueOnce({ rows: [{ raw_response: rawResponse(1000, 500), completed_at: oldDate }] });
    const result = await reconcileGLCashToMpesaBalance();
    expect(result.status).toBe('stale_snapshot');
  });

  it('reports ok when GL cash matches the M-Pesa balance within tolerance', async () => {
    const recent = new Date().toISOString();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ raw_response: rawResponse(700, 300), completed_at: recent }] })
      .mockResolvedValueOnce({ rows: [{ total: '1000.00' }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await reconcileGLCashToMpesaBalance();
    expect(result.status).toBe('ok');
    expect(result.difference).toBe('0.00');
  });

  it('reports mismatch and records it when GL cash diverges from the M-Pesa balance', async () => {
    const recent = new Date().toISOString();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ raw_response: rawResponse(700, 300), completed_at: recent }] })
      .mockResolvedValueOnce({ rows: [{ total: '850.00' }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await reconcileGLCashToMpesaBalance();
    expect(result.status).toBe('mismatch');
    expect(result.difference).toBe('150.00');
    expect(mockQuery).toHaveBeenCalledTimes(3);
    const insertCall = mockQuery.mock.calls[2];
    expect(insertCall[0]).toContain('gl_cash_mismatch');
  });
});
