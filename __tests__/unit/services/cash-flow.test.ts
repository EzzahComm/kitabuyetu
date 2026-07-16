/**
 * Cash Flow Statement + Statement of Changes in Equity (audit §12 — the two
 * financial statements the platform lacked entirely). Covers the IAS 7
 * section classification (member lending = operating) and the
 * opening + netChange = closing reconciliation flag.
 */
import { withDb } from '@/lib/db';
import { accountingService } from '@/lib/services/accounting.service';

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
});

const ctx = { groupId: 'g1', userId: 'u1', role: 'treasurer' };

describe('getCashFlowStatement', () => {
  it('classifies counter-accounts into IAS 7 sections (lending = operating)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [
        { account_code: '4001', account_name: 'Member Contributions', type: 'income',    cash_impact: '10000' },
        { account_code: '5002', account_name: 'SMS Expenses',         type: 'expense',   cash_impact: '-500' },
        { account_code: '1101', account_name: 'Loans Receivable',     type: 'asset',     cash_impact: '-7000' },
        { account_code: '1201', account_name: 'Fixed Assets',         type: 'asset',     cash_impact: '-2000' },
        { account_code: '3001', account_name: 'Member Equity',        type: 'equity',    cash_impact: '3000' },
        { account_code: '2103', account_name: 'Dividends Payable',    type: 'liability', cash_impact: '-1500' },
        { account_code: '2102', account_name: 'Welfare Fund',         type: 'liability', cash_impact: '800' },
      ]})
      .mockResolvedValueOnce({ rows: [{ opening: '5000', closing: '7800' }] });

    const cf = await accountingService.getCashFlowStatement(ctx, '2026-01-01', '2026-12-31');

    expect(cf.operating.map((l) => l.accountCode)).toEqual(['4001', '5002', '1101', '2102']);
    expect(cf.investing.map((l) => l.accountCode)).toEqual(['1201']);
    expect(cf.financing.map((l) => l.accountCode)).toEqual(['3001', '2103']);

    expect(cf.netOperating).toBe('3300.00');  // 10000 - 500 - 7000 + 800
    expect(cf.netInvesting).toBe('-2000.00');
    expect(cf.netFinancing).toBe('1500.00');  // 3000 - 1500
    expect(cf.netChange).toBe('2800.00');
    expect(cf.openingCash).toBe('5000.00');
    expect(cf.closingCash).toBe('7800.00');
    expect(cf.reconciles).toBe(true);         // 5000 + 2800 = 7800
  });

  it('flags non-reconciliation instead of silently presenting wrong numbers', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [
        { account_code: '4001', account_name: 'Member Contributions', type: 'income', cash_impact: '1000' },
      ]})
      .mockResolvedValueOnce({ rows: [{ opening: '0', closing: '9999' }] });

    const cf = await accountingService.getCashFlowStatement(ctx, '2026-01-01', '2026-12-31');
    expect(cf.reconciles).toBe(false);
  });
});

describe('getEquityChanges', () => {
  it('computes closing = opening + increases − decreases per account', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [
        { account_code: '3001', account_name: 'Member Equity',    opening: '10000', increases: '3000', decreases: '500' },
        { account_code: '3101', account_name: 'Retained Surplus', opening: '2000',  increases: '0',    decreases: '1000' },
      ]})
      .mockResolvedValueOnce({ rows: [{ net: '4200' }] });

    const sce = await accountingService.getEquityChanges(ctx, '2026-01-01', '2026-12-31');

    expect(sce.lines[0].closing).toBe('12500.00');
    expect(sce.lines[1].closing).toBe('1000.00');
    expect(sce.totalOpening).toBe('12000.00');
    expect(sce.totalClosing).toBe('13500.00');
    expect(sce.periodNetProfit).toBe('4200.00');
  });
});
