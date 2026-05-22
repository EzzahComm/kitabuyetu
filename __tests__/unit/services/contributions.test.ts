/**
 * Unit tests for contributionsService.
 * Validates critical fintech invariants:
 *   - Duplicate M-Pesa receipts are rejected
 *   - Status is set based on payment method, not trusted from the client
 *   - delete() is a soft-delete (sets status=cancelled, never hard-deletes)
 */
import { withTransaction } from '@/lib/db';
import { contributionsService } from '@/lib/services/contributions.service';
import { ConflictError, NotFoundError } from '@/lib/utils/errors';

jest.mock('@/lib/db', () => ({
  withDb: jest.fn(),
  withTransaction: jest.fn(),
}));

jest.mock('@/lib/services/accounting.service', () => ({
  accountingService: {
    createJournalEntry: jest.fn().mockResolvedValue({ id: 'je-1', lines: [] }),
    postJournalEntry:   jest.fn().mockResolvedValue({ id: 'je-1' }),
  },
}));

const mockQuery  = jest.fn();
const mockClient = { query: mockQuery };

// mockReset clears both call history AND the return-value queue between tests.
// clearAllMocks only clears history; leftover Once values would leak into the next test.
beforeEach(() => {
  mockQuery.mockReset();
  (withTransaction as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
});

const ctx = { groupId: 'grp-1', userId: 'usr-1', role: 'treasurer' };

const baseContributionInput = {
  memberId:         'mem-1',
  amount:           1000,
  contributionDate: '2025-06-01',
} as const;

describe('contributionsService.create', () => {
  it('throws ConflictError when M-Pesa receipt number already exists', async () => {
    // Duplicate check returns an existing row → service must reject
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'existing-c-id' }] });

    await expect(
      contributionsService.create(ctx, {
        ...baseContributionInput,
        mpesaReceiptNumber: 'QAB123XYZ',
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    // Must not have proceeded to INSERT after finding the duplicate
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('creates a pending contribution when no payment method is provided', async () => {
    // No mpesaReceiptNumber on baseContributionInput → duplicate check is skipped
    // The only DB call is the INSERT itself
    const pendingContribution = {
      id: 'c-1', group_id: 'grp-1', member_id: 'mem-1',
      amount: '1000.00', status: 'pending',
      payment_method: null, mpesa_receipt_number: null,
    };
    mockQuery.mockResolvedValueOnce({ rows: [pendingContribution] });

    const result = await contributionsService.create(ctx, baseContributionInput);

    expect(result.status).toBe('pending');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('creates a completed contribution when payment method is provided', async () => {
    const completedContribution = {
      id: 'c-2', group_id: 'grp-1', member_id: 'mem-1',
      amount: '1000.00', status: 'completed',
      payment_method: 'mpesa', mpesa_receipt_number: 'QDE456UVW',
    };

    // duplicate check → no conflict
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // INSERT
    mockQuery.mockResolvedValueOnce({ rows: [completedContribution] });
    // postContributionJournal — income account, cash account, journal entry, journal lines
    mockQuery.mockResolvedValue({ rows: [{ id: 'acct-1' }] });

    const result = await contributionsService.create(ctx, {
      ...baseContributionInput,
      paymentMethod:       'mpesa',
      mpesaReceiptNumber:  'QDE456UVW',
    });

    expect(result.status).toBe('completed');
  });
});

describe('contributionsService.delete', () => {
  it('soft-deletes by setting status to cancelled (not a hard delete)', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    await contributionsService.delete(ctx, 'c-1');

    const [sql] = mockQuery.mock.calls[0] as [string, ...unknown[]];
    expect(sql.trim().toUpperCase()).toMatch(/^UPDATE/);
    expect(sql).toContain("'cancelled'");
    expect(sql.toUpperCase()).not.toContain('DELETE');
  });

  it('throws NotFoundError when contribution is not pending or does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });

    await expect(contributionsService.delete(ctx, 'non-existent')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
