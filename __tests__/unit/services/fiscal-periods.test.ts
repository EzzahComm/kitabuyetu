/**
 * Tests for fiscalPeriodsService (ACCOUNTING_ARCHITECTURE_AUDIT.md §13
 * Critical finding — no period-locking mechanism existed at all). The
 * blocking behavior itself lives in a DB trigger (migration 083) that isn't
 * exercised by mocked-query unit tests; these cover the service-layer
 * guards: reopen requires an existing closed period, and can't reopen an
 * already-open one.
 */
import { withDb, withTransaction } from '@/lib/db';
import { fiscalPeriodsService } from '@/lib/services/fiscal-periods.service';
import { ConflictError, NotFoundError } from '@/lib/utils/errors';

jest.mock('@/lib/db', () => ({
  withDb: jest.fn(),
  withTransaction: jest.fn(),
}));

const mockQuery  = jest.fn();
const mockClient = { query: mockQuery };

beforeEach(() => {
  mockQuery.mockReset();
  (withDb as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
  (withTransaction as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
});

const ctx = { groupId: 'group-1', userId: 'user-1', role: 'treasurer' };

describe('fiscalPeriodsService.close', () => {
  it('upserts a closed period row and writes an audit log', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'fp-1', group_id: 'group-1', period_start: '2026-01-01', period_end: '2026-01-31', status: 'closed' }] })
      .mockResolvedValueOnce({ rows: [] }); // audit log

    const result = await fiscalPeriodsService.close(ctx, { periodStart: '2026-01-01', periodEnd: '2026-01-31' });

    expect(result.status).toBe('closed');
    const insertCall = mockQuery.mock.calls[0];
    expect(insertCall[0]).toContain('ON CONFLICT (group_id, period_start) DO UPDATE');
    expect(insertCall[1]).toEqual(['group-1', '2026-01-01', '2026-01-31', 'user-1']);
  });
});

describe('fiscalPeriodsService.reopen', () => {
  it('throws NotFoundError when the period does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(fiscalPeriodsService.reopen(ctx, 'fp-1', { reason: 'Correcting a posting error' }))
      .rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ConflictError when the period is already open', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'fp-1', status: 'open' }] });
    await expect(fiscalPeriodsService.reopen(ctx, 'fp-1', { reason: 'Correcting a posting error' }))
      .rejects.toBeInstanceOf(ConflictError);
  });

  it('reopens a closed period and records the reason', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'fp-1', status: 'closed' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'fp-1', status: 'open', reopen_reason: 'Correcting a posting error' }] })
      .mockResolvedValueOnce({ rows: [] }); // audit log

    const result = await fiscalPeriodsService.reopen(ctx, 'fp-1', { reason: 'Correcting a posting error' });

    expect(result.status).toBe('open');
    const updateCall = mockQuery.mock.calls[1];
    expect(updateCall[1]).toEqual(['fp-1', 'user-1', 'Correcting a posting error']);
  });
});
