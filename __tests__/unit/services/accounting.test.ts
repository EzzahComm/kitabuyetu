/**
 * Tests for the pure aggregation logic in accountingService.getProfitAndLoss.
 * DB queries are mocked so we're validating the sign convention fix:
 *   income accounts  → credit - debit  (returns positive total for credit-normal)
 *   expense accounts → debit - credit  (returns positive total for debit-normal)
 * And that netProfit = totalIncome - totalExpenses.
 */
import { withDb } from '@/lib/db';
import { accountingService } from '@/lib/services/accounting.service';

jest.mock('@/lib/db', () => ({
  withDb: jest.fn(),
  withTransaction: jest.fn(),
}));

const mockQuery  = jest.fn();
const mockClient = { query: mockQuery };

beforeEach(() => {
  mockQuery.mockReset();
  (withDb as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
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
