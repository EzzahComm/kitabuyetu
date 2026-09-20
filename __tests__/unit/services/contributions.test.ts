/**
 * Unit tests for contributionsService.
 * Validates critical fintech invariants:
 *   - Duplicate M-Pesa receipts are rejected
 *   - Status is set based on payment method, not trusted from the client
 *   - delete() is a soft-delete (sets status=cancelled, never hard-deletes)
 */
import { withTransaction } from '@/lib/db';
import { contributionsService } from '@/lib/services/contributions.service';
import { postContributionJournal } from '@/lib/services/accounting.service';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/utils/errors';

jest.mock('@/lib/db', () => ({
  withDb: jest.fn(),
  withTransaction: jest.fn(),
}));

jest.mock('@/lib/services/accounting.service', () => ({
  accountingService: {
    createJournalEntry: jest.fn().mockResolvedValue({ id: 'je-1', lines: [] }),
    postJournalEntry: jest.fn().mockResolvedValue({ id: 'je-1' }),
  },
  postContributionJournal: jest.fn().mockResolvedValue('je-1'),
}));

// contributionsService.create() dynamically imports this on the completed-
// contribution path (Phase 9.4.1 event emission) — mock it like every other
// dependency here so a completed-contribution test exercises this service in
// isolation, not the real trigger engine.
jest.mock('@/lib/sms/trigger-engine', () => ({
  emitBusinessEvent: jest.fn().mockResolvedValue({ evaluated: 0, matched: 0, dispatched: 0, deferred: 0, skipped: 0 }),
}));

const mockQuery = jest.fn();
const mockClient = { query: mockQuery };

// mockReset clears both call history AND the return-value queue between tests.
// clearAllMocks only clears history; leftover Once values would leak into the next test.
beforeEach(() => {
  mockQuery.mockReset();
  (withTransaction as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
});

const ctx = { groupId: 'grp-1', userId: 'usr-1', role: 'treasurer' };

const baseContributionInput = {
  memberId: 'mem-1',
  amount: 1000,
  contributionDate: '2025-06-01',
} as const;

// First query in create() is always the membership guard (audit H-1).
const membershipRow = { rows: [{ id: 'gm-1', member_code: 'KY000000100001' }] };

describe('contributionsService.create', () => {
  it('throws ValidationError when the member has no active membership in the group', async () => {
    // Membership guard finds nothing → reject before any write
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(contributionsService.create(ctx, baseContributionInput)).rejects.toBeInstanceOf(ValidationError);

    // Guard query only — no duplicate check, no INSERT
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('throws ConflictError when M-Pesa receipt number already exists', async () => {
    // Membership guard passes
    mockQuery.mockResolvedValueOnce(membershipRow);
    // Duplicate check returns an existing row → service must reject
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'existing-c-id' }] });

    await expect(
      contributionsService.create(ctx, {
        ...baseContributionInput,
        mpesaReceiptNumber: 'QAB123XYZ',
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    // Must not have proceeded to INSERT after finding the duplicate
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('creates a pending contribution when no payment method is provided', async () => {
    // No mpesaReceiptNumber on baseContributionInput → duplicate check is skipped
    // DB calls: membership guard, then the INSERT itself
    const pendingContribution = {
      id: 'c-1',
      group_id: 'grp-1',
      member_id: 'mem-1',
      amount: '1000.00',
      status: 'pending',
      payment_method: null,
      mpesa_receipt_number: null,
    };
    mockQuery.mockResolvedValueOnce(membershipRow);
    mockQuery.mockResolvedValueOnce({ rows: [pendingContribution] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // audit log: contribution.create

    const result = await contributionsService.create(ctx, baseContributionInput);

    expect(result.status).toBe('pending');
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  it('creates a completed contribution when payment method is provided', async () => {
    const completedContribution = {
      id: 'c-2',
      group_id: 'grp-1',
      member_id: 'mem-1',
      amount: '1000.00',
      status: 'completed',
      contribution_date: new Date('2025-06-01'),
      payment_method: 'mpesa',
      mpesa_receipt_number: 'QDE456UVW',
    };

    // membership guard → active membership found
    mockQuery.mockResolvedValueOnce(membershipRow);
    // duplicate check → no conflict
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // INSERT
    mockQuery.mockResolvedValueOnce({ rows: [completedContribution] });

    const result = await contributionsService.create(ctx, {
      ...baseContributionInput,
      paymentMethod: 'mpesa',
      mpesaReceiptNumber: 'QDE456UVW',
    });

    expect(result.status).toBe('completed');
    // Posting is delegated to the shared accounting.service function, not
    // reimplemented locally (ACCOUNTING_ARCHITECTURE_AUDIT.md §6 consolidation).
    expect(postContributionJournal).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({
        groupId: 'grp-1',
        contributionId: 'c-2',
        amount: 1000,
      }),
    );
  });
});

describe('contributionsService.delete', () => {
  it('soft-deletes by setting status to cancelled (not a hard delete)', async () => {
    // existence/status guard (SELECT ... WHERE status = 'pending')
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c-1', status: 'pending' }] });
    mockQuery.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE
    mockQuery.mockResolvedValueOnce({ rows: [] }); // audit log: contribution.delete

    await contributionsService.delete(ctx, 'c-1');

    const [sql] = mockQuery.mock.calls[1] as [string, ...unknown[]];
    expect(sql.trim().toUpperCase()).toMatch(/^UPDATE/);
    expect(sql).toContain("'cancelled'");
    expect(sql.toUpperCase()).not.toContain('DELETE');
  });

  it('throws NotFoundError when contribution is not pending or does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no pending row found

    await expect(contributionsService.delete(ctx, 'non-existent')).rejects.toBeInstanceOf(NotFoundError);
  });
});
