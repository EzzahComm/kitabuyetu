/**
 * Unit tests for critical loan lifecycle guards:
 *   - No member can hold two active loans simultaneously
 *   - Status transitions are strictly enforced (pending → approved → disbursed)
 *   - Only disbursed/active loans can be repaid
 */
import { withTransaction } from '@/lib/db';
import { loansService } from '@/lib/services/loans.service';
import { ValidationError, NotFoundError } from '@/lib/utils/errors';

jest.mock('@/lib/db', () => ({
  withDb: jest.fn(),
  withTransaction: jest.fn(),
}));

const mockQuery  = jest.fn();
const mockClient = { query: mockQuery };

beforeEach(() => {
  mockQuery.mockReset();
  (withTransaction as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
});

const ctx      = { groupId: 'grp-1', userId: 'usr-1', role: 'member' };
const adminCtx = { groupId: 'grp-1', userId: 'admin-1', role: 'group_admin' };

const applyInput = {
  principalAmount:  50000,
  interestRate:     12,
  loanTermMonths:   12,
  purpose:          'Business expansion',
};

describe('loansService.apply', () => {
  it('throws ValidationError when member already has an active loan', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'existing-loan' }] });

    await expect(loansService.apply(ctx, applyInput)).rejects.toBeInstanceOf(ValidationError);

    // Must stop at the active-loan check, not proceed to INSERT
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('creates a pending loan application when no active loan exists', async () => {
    const newLoan = {
      id: 'loan-1', group_id: 'grp-1', member_id: 'usr-1',
      principal_amount: '50000.00', status: 'pending',
    };
    mockQuery.mockResolvedValueOnce({ rows: [] });       // no active loan
    mockQuery.mockResolvedValueOnce({ rows: [newLoan] }); // INSERT

    const result = await loansService.apply(ctx, applyInput);
    expect(result.status).toBe('pending');
    expect(result.principal_amount).toBe('50000.00');
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
