/**
 * Unit tests for critical loan lifecycle guards:
 *   - No member can hold two active loans simultaneously
 *   - Status transitions are strictly enforced (pending → approved → disbursed)
 *   - Only disbursed/active loans can be repaid
 */
import { withTransaction } from '@/lib/db';
import { loansService } from '@/lib/services/loans.service';
import { postTemplatedJournal } from '@/lib/services/posting-templates.service';
import { ValidationError, NotFoundError, ForbiddenError } from '@/lib/utils/errors';

jest.mock('@/lib/db', () => ({
  withDb: jest.fn(),
  withTransaction: jest.fn(),
}));

jest.mock('@/lib/services/posting-templates.service', () => ({
  postTemplatedJournal:        jest.fn().mockResolvedValue('je-writeoff-1'),
  postLoanDisbursementJournal: jest.fn(),
  postLoanRepaymentJournal:    jest.fn(),
}));

const mockQuery  = jest.fn();
const mockClient = { query: mockQuery };

beforeEach(() => {
  mockQuery.mockReset();
  (withTransaction as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
  (postTemplatedJournal as jest.Mock).mockClear();
});

const ctx      = { groupId: 'grp-1', userId: 'usr-1', role: 'member' };
const adminCtx = { groupId: 'grp-1', userId: 'admin-1', role: 'chairperson' };

const applyInput = {
  principalAmount:  50000,
  interestRate:     12,
  loanTermMonths:   12,
  purpose:          'Business expansion',
};

describe('loansService.apply', () => {
  const membershipRow = { rows: [{ id: 'gm-1', member_code: 'KY000000000001' }] };

  it('throws ValidationError when the applicant has no active membership', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // guard: no membership

    await expect(loansService.apply(ctx, applyInput)).rejects.toBeInstanceOf(ValidationError);

    // Must stop at the membership guard, not proceed to the loan checks
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('throws ValidationError when member already has an active loan', async () => {
    mockQuery.mockResolvedValueOnce(membershipRow);                  // guard
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'existing-loan' }] }); // active-loan check

    await expect(loansService.apply(ctx, applyInput)).rejects.toBeInstanceOf(ValidationError);

    // Must stop at the active-loan check, not proceed to INSERT
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('creates a pending loan application when no active loan exists', async () => {
    const newLoan = {
      id: 'loan-1', group_id: 'grp-1', member_id: 'usr-1',
      principal_amount: '50000.00', status: 'pending',
    };
    mockQuery.mockResolvedValueOnce(membershipRow);       // guard
    mockQuery.mockResolvedValueOnce({ rows: [] });        // no active loan
    mockQuery.mockResolvedValueOnce({ rows: [newLoan] }); // INSERT

    const result = await loansService.apply(ctx, applyInput);
    expect(result.status).toBe('pending');
    expect(result.principal_amount).toBe('50000.00');

    // The INSERT stamps the guard-validated membership id (§6a)
    const insertCall = mockQuery.mock.calls[2];
    expect(insertCall[0]).toContain('group_membership_id');
    expect(insertCall[1]).toContain('gm-1');
  });
});

describe('loansService.approve', () => {
  it('throws NotFoundError when loan does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(loansService.approve(adminCtx, 'non-existent', {})).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('throws ValidationError when loan is already approved (idempotency guard)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'loan-1', status: 'approved', group_id: 'grp-1' }] });

    await expect(loansService.approve(adminCtx, 'loan-1', {})).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('throws ValidationError when loan is already disbursed', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'loan-1', status: 'disbursed', group_id: 'grp-1' }] });

    await expect(loansService.approve(adminCtx, 'loan-1', {})).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('approves a pending loan successfully', async () => {
    const pendingLoan  = { id: 'loan-1', status: 'pending',  group_id: 'grp-1' };
    const approvedLoan = { id: 'loan-1', status: 'approved', group_id: 'grp-1' };

    mockQuery.mockResolvedValueOnce({ rows: [pendingLoan] });
    mockQuery.mockResolvedValueOnce({ rows: [approvedLoan] });

    const result = await loansService.approve(adminCtx, 'loan-1', {});
    expect(result.status).toBe('approved');
  });
});

describe('loansService.disburse', () => {
  const disburseInput = {
    disbursementDate:    '2025-06-01',
    paymentMethod:       'mpesa' as const,
    mpesaReceiptNumber:  'QAB123XYZ',
  };

  it('throws ValidationError when disbursing a pending (not yet approved) loan', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'loan-1', status: 'pending', group_id: 'grp-1' }] });

    await expect(loansService.disburse(adminCtx, 'loan-1', disburseInput)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('throws ValidationError when disbursing an already disbursed loan', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'loan-1', status: 'disbursed', group_id: 'grp-1' }] });

    await expect(loansService.disburse(adminCtx, 'loan-1', disburseInput)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe('loansService.reject', () => {
  it('can reject a pending loan', async () => {
    const pendingLoan  = { id: 'loan-1', status: 'pending',  group_id: 'grp-1' };
    const rejectedLoan = { id: 'loan-1', status: 'rejected', group_id: 'grp-1' };

    mockQuery.mockResolvedValueOnce({ rows: [pendingLoan] });
    mockQuery.mockResolvedValueOnce({ rows: [rejectedLoan] });

    const result = await loansService.reject(adminCtx, 'loan-1', { reason: 'Insufficient collateral' });
    expect(result.status).toBe('rejected');
  });

  it('can reject an approved loan before disbursement', async () => {
    const approvedLoan = { id: 'loan-1', status: 'approved', group_id: 'grp-1' };
    const rejectedLoan = { id: 'loan-1', status: 'rejected', group_id: 'grp-1' };

    mockQuery.mockResolvedValueOnce({ rows: [approvedLoan] });
    mockQuery.mockResolvedValueOnce({ rows: [rejectedLoan] });

    const result = await loansService.reject(adminCtx, 'loan-1', { reason: 'Changed decision' });
    expect(result.status).toBe('rejected');
  });

  it('throws ValidationError when trying to reject a disbursed loan', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'loan-1', status: 'disbursed', group_id: 'grp-1' }] });

    await expect(
      loansService.reject(adminCtx, 'loan-1', { reason: 'Too late' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ACCOUNTING_ARCHITECTURE_AUDIT.md §15 — write-off workflow with maker-checker.
// The DB CHECK constraint (migration 084) is the authoritative backstop; these
// cover the application-level guards that surface a clean error first.
describe('loansService.markDefaulted', () => {
  it('throws ValidationError when the loan is not active', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'loan-1', status: 'disbursed', group_id: 'grp-1' }] });
    await expect(
      loansService.markDefaulted(adminCtx, 'loan-1', { reason: 'Missed 3 payments' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('marks an active loan defaulted', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'loan-1', status: 'active', group_id: 'grp-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'loan-1', status: 'defaulted', defaulted_by: 'admin-1' }] })
      .mockResolvedValueOnce({ rows: [] }); // audit log

    const result = await loansService.markDefaulted(adminCtx, 'loan-1', { reason: 'Missed 3 payments' });
    expect(result.status).toBe('defaulted');
  });
});

describe('loansService.writeOff', () => {
  it('throws ValidationError when the loan is not defaulted', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'loan-1', status: 'active', group_id: 'grp-1' }] });
    await expect(
      loansService.writeOff(adminCtx, 'loan-1', { reason: 'Uncollectible' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('blocks the officer who marked the loan defaulted from writing it off (maker-checker)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'loan-1', status: 'defaulted', group_id: 'grp-1', defaulted_by: 'admin-1', outstanding_balance: '5000.00' }],
    });
    await expect(
      loansService.writeOff(adminCtx, 'loan-1', { reason: 'Uncollectible' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // Never reaches posting or the UPDATE
    expect(postTemplatedJournal).not.toHaveBeenCalled();
  });

  it('allows a different officer to write off, posting via the loan_writeoff template', async () => {
    const writerCtx = { groupId: 'grp-1', userId: 'writer-1', role: 'chairperson' };
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 'loan-1', status: 'defaulted', group_id: 'grp-1', defaulted_by: 'admin-1', outstanding_balance: '5000.00' }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'loan-1', status: 'written_off' }] })
      .mockResolvedValueOnce({ rows: [] }); // audit log

    const result = await loansService.writeOff(writerCtx, 'loan-1', { reason: 'Confirmed uncollectible' });

    expect(result.status).toBe('written_off');
    expect(postTemplatedJournal).toHaveBeenCalledWith(
      mockClient, 'grp-1', 'writer-1', 'loan_writeoff', expect.stringContaining('loan-1'),
      { outstanding: 5000 },
      { reference: 'loan-1' },
    );
  });

  it('skips posting when the outstanding balance is zero', async () => {
    const writerCtx = { groupId: 'grp-1', userId: 'writer-1', role: 'chairperson' };
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 'loan-1', status: 'defaulted', group_id: 'grp-1', defaulted_by: 'admin-1', outstanding_balance: '0.00' }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'loan-1', status: 'written_off' }] })
      .mockResolvedValueOnce({ rows: [] });

    await loansService.writeOff(writerCtx, 'loan-1', { reason: 'Zero balance cleanup' });
    expect(postTemplatedJournal).not.toHaveBeenCalled();
  });
});
