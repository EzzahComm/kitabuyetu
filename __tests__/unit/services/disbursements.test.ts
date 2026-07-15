/**
 * Unified B2C disbursement spine — closes B2C_DISBURSEMENT_AUDIT.md C1-C5:
 *   - C1: balance check before any Daraja call
 *   - C2: idempotent replay returns the existing row, never a second payout
 *   - C3: maker-checker (threshold parks pending_approval; approver != initiator)
 *   - C4: dispatch only happens through this module
 */
import { withDb, withTransaction, withAdminDb } from '@/lib/db';
import { disbursementsService } from '@/lib/services/disbursements.service';
import { initiateB2C } from '@/lib/services/mpesa.service';
import { ValidationError, ForbiddenError, NotFoundError } from '@/lib/utils/errors';

jest.mock('@/lib/db', () => ({
  withDb: jest.fn(),
  withTransaction: jest.fn(),
  withAdminDb: jest.fn(),
}));
jest.mock('@/lib/services/mpesa.service', () => ({
  initiateB2C: jest.fn(),
}));

const mockQuery  = jest.fn();
const mockClient = { query: mockQuery };

beforeEach(() => {
  mockQuery.mockReset();
  (initiateB2C as jest.Mock).mockReset().mockResolvedValue({
    conversationId: 'c1', originatorConversationId: 'o1', responseDescription: 'ok',
  });
  (withDb as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
  (withTransaction as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
  (withAdminDb as jest.Mock).mockImplementation((fn) => fn(mockClient));
});

const ctx = { groupId: 'grp-1', userId: 'treasurer-1', role: 'treasurer' };

const input = {
  phone: '254712345678', amount: 5000, occasion: 'Loan disbursement',
  idempotencyKey: 'idem-key-1',
};

const cashAccount = (balance: string, reserved = '0.00') => ({
  rows: [{ id: 'acct-1', balance, reserved_amount: reserved }],
});

describe('disbursementsService.initiateDisbursement', () => {
  it('rejects when available balance is insufficient (C1)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });        // idempotency lookup: none
    mockQuery.mockResolvedValueOnce(cashAccount('1000.00')); // balance too low

    await expect(disbursementsService.initiateDisbursement(ctx, input))
      .rejects.toBeInstanceOf(ValidationError);
    expect(initiateB2C).not.toHaveBeenCalled();
  });

  it('treats reserved_amount as unavailable (C1)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // balance 5000, but 4000 already reserved -> only 1000 available < 5000 requested
    mockQuery.mockResolvedValueOnce(cashAccount('5000.00', '4000.00'));

    await expect(disbursementsService.initiateDisbursement(ctx, input))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('returns the existing row on idempotent replay without re-reserving (C2)', async () => {
    const existing = {
      id: 'disb-1', group_id: 'grp-1', status: 'completed', requires_approval: false,
      initiated_by: 'treasurer-1', amount: '5000.00',
    };
    mockQuery.mockResolvedValueOnce({ rows: [existing] }); // idempotency lookup: found
    mockQuery.mockResolvedValueOnce({ rows: [existing] }); // getById refresh

    const result = await disbursementsService.initiateDisbursement(ctx, input);

    expect(result.id).toBe('disb-1');
    expect(initiateB2C).not.toHaveBeenCalled();
    // Only the lookup + getById queries ran — no balance check, no reservation.
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('dispatches immediately when under the group threshold', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });                 // idempotency lookup
    mockQuery.mockResolvedValueOnce(cashAccount('50000.00'));      // balance check
    mockQuery.mockResolvedValueOnce({ rows: [{ threshold: '20000.00' }] }); // group threshold
    mockQuery.mockResolvedValueOnce({ rows: [] });                 // reserve UPDATE
    mockQuery.mockResolvedValueOnce({                              // INSERT disbursement_requests
      rows: [{
        id: 'disb-2', group_id: 'grp-1', status: 'approved', requires_approval: false,
        initiated_by: 'treasurer-1', amount: '5000.00',
      }],
    });
    // dispatchDisbursement: claim (UPDATE ... RETURNING)
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'disb-2', group_id: 'grp-1', loan_id: null, phone: input.phone, amount: '5000.00',
        command_id: 'BusinessPayment', occasion: input.occasion, initiated_by: 'treasurer-1',
        cash_account_id: 'acct-1',
      }],
    });
    mockQuery.mockResolvedValueOnce({ // getById refresh
      rows: [{
        id: 'disb-2', group_id: 'grp-1', status: 'dispatched', requires_approval: false,
        initiated_by: 'treasurer-1', amount: '5000.00',
      }],
    });

    const result = await disbursementsService.initiateDisbursement(ctx, input);

    expect(result.needsApproval).toBe(false);
    expect(initiateB2C).toHaveBeenCalledTimes(1);
    expect(initiateB2C).toHaveBeenCalledWith(expect.objectContaining({ disbursementRequestId: 'disb-2' }));
  });

  it('parks pending_approval above threshold and never dispatches (C3)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });                  // idempotency lookup
    mockQuery.mockResolvedValueOnce(cashAccount('100000.00'));      // balance check
    mockQuery.mockResolvedValueOnce({ rows: [{ threshold: '2000.00' }] }); // low threshold
    mockQuery.mockResolvedValueOnce({ rows: [] });                  // reserve UPDATE
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'disb-3', group_id: 'grp-1', status: 'pending_approval', requires_approval: true,
        initiated_by: 'treasurer-1', amount: '5000.00',
      }],
    });
    mockQuery.mockResolvedValueOnce({ // getById refresh
      rows: [{
        id: 'disb-3', group_id: 'grp-1', status: 'pending_approval', requires_approval: true,
        initiated_by: 'treasurer-1', amount: '5000.00',
      }],
    });

    const result = await disbursementsService.initiateDisbursement(ctx, input);

    expect(result.needsApproval).toBe(true);
    expect(initiateB2C).not.toHaveBeenCalled();
  });

  it('gates loan-linked disbursement on loan status = approved (F11)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });                             // idempotency lookup
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'loan-1', status: 'pending' }] }); // loan not approved

    await expect(
      disbursementsService.initiateDisbursement(ctx, { ...input, loanId: 'loan-1' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(initiateB2C).not.toHaveBeenCalled();
  });
});

describe('disbursementsService.approve', () => {
  it('refuses approval by the initiator (maker-checker, C3)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'disb-1', initiated_by: 'treasurer-1', status: 'pending_approval' }],
    });

    await expect(disbursementsService.approve(ctx, 'disb-1'))
      .rejects.toBeInstanceOf(ForbiddenError);
    expect(initiateB2C).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when no pending row matches', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(disbursementsService.approve(ctx, 'missing'))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('disbursementsService.reject', () => {
  it('releases the reservation and marks rejected', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ cash_account_id: 'acct-1', amount: '5000.00' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // release UPDATE
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'disb-1', status: 'rejected', rejection_reason: 'wrong number' }],
    });

    const result = await disbursementsService.reject(ctx, 'disb-1', 'wrong number');
    expect(result.status).toBe('rejected');
    // The release UPDATE targets accounts.reserved_amount.
    expect(mockQuery.mock.calls[1][0]).toContain('reserved_amount');
  });
});
