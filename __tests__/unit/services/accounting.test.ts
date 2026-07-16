/**
 * Tests for the pure aggregation logic in accountingService.getProfitAndLoss.
 * DB queries are mocked so we're validating the sign convention fix:
 *   income accounts  → credit - debit  (returns positive total for credit-normal)
 *   expense accounts → debit - credit  (returns positive total for debit-normal)
 * And that netProfit = totalIncome - totalExpenses.
 */
import { withDb, withTransaction, withAdminDb } from '@/lib/db';
import { accountingService, reconcileGLCashToMpesaBalance, postSystemJournal } from '@/lib/services/accounting.service';
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
});

// ACCOUNTING_ARCHITECTURE_AUDIT.md §15 — manual journal maker-checker.
// The DB trigger (migration 081) is the authoritative backstop; these tests
// cover the application-level check that surfaces a clean ForbiddenError
// instead of a raw constraint violation.
describe('postJournalEntry maker-checker', () => {
  it('blocks the creator from posting their own entry above the threshold', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'je-1', created_by: 'user-1', group_id: 'group-1', status: 'draft' }] })
      .mockResolvedValueOnce({ rows: [{ threshold: '1000.00' }] })
      .mockResolvedValueOnce({ rows: [{ total: '5000.00' }] });

    await expect(accountingService.postJournalEntry(ctx, 'je-1')).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockQuery).toHaveBeenCalledTimes(3); // never reaches the UPDATE or audit-log insert
  });

  it('allows the creator to post their own entry at or under the threshold', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'je-1', created_by: 'user-1', group_id: 'group-1', status: 'draft' }] })
      .mockResolvedValueOnce({ rows: [{ threshold: '10000.00' }] })
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
      .mockResolvedValueOnce({ rows: [{ threshold: '1000.00' }] })
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
