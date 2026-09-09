/**
 * Disbursement watchdog timeout resolution — closes B2C_DISBURSEMENT_AUDIT.md
 * C5 for all three money-out spines. Covers: correct table/in-flight-status
 * per kind, and the idempotent no-op when the real callback handler already
 * resolved the row before the watchdog's timeout fired.
 */
import { withAdminDb } from '@/lib/db';
import { resolveWatchdogTimeout } from '@/lib/services/disbursement-watchdog.service';

jest.mock('@/lib/db', () => ({
  withAdminDb: jest.fn(),
}));
jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockQuery  = jest.fn();
const mockClient = { query: mockQuery };

beforeEach(() => {
  mockQuery.mockReset();
  (withAdminDb as jest.Mock).mockImplementation((fn) => fn(mockClient));
});

describe('resolveWatchdogTimeout', () => {
  it.each([
    ['disbursement', 'disbursement_requests', 'dispatched'],
    ['settlement', 'settlement_requests', 'processing'],
    ['vendor_payment', 'vendor_payments', 'processing'],
  ] as const)('flips a stuck %s row to timed_out (table %s, in-flight status %s)', async (kind, table, inProgressStatus) => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'row-1', group_id: 'grp-1', amount: '5000.00' }],
    });

    const result = await resolveWatchdogTimeout(kind, 'row-1');

    expect(result).toEqual({ resolved: true });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain(table);
    expect(sql).toContain("status = 'timed_out'");
    expect(params).toEqual(['row-1', inProgressStatus]);
  });

  it('is a safe no-op when the real callback handler already resolved the row', async () => {
    // WHERE status = inProgressStatus matches nothing once the row is
    // already 'completed'/'failed' — RETURNING yields zero rows.
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await resolveWatchdogTimeout('disbursement', 'row-2');

    expect(result).toEqual({ resolved: false });
  });

  it('never touches reserved_amount or any accounts table', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'row-3', group_id: 'grp-1', amount: '1000.00' }],
    });

    await resolveWatchdogTimeout('disbursement', 'row-3');

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).not.toMatch(/reserved_amount/i);
    expect(sql).not.toMatch(/\baccounts\b/i);
  });
});
