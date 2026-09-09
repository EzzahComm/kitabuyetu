/**
 * Bank Accounts / Settlements / Vendor Payments — dual control, fund
 * reservation, and the per-row expense-account validation.
 *
 * These cover the parts that don't need Daraja: everything up to (and
 * including) approval's own guard. The dispatch call itself is mocked at the
 * module boundary — what's asserted is the state machine around it, which is
 * where the money-safety properties live.
 */
import { withDb, withTransaction, withAdminDb } from '@/lib/db';
import { groupBankAccountsService } from '@/lib/services/group-bank-accounts.service';
import { settlementsService } from '@/lib/services/settlements.service';
import { vendorPaymentsService } from '@/lib/services/vendor-payments.service';
import { ValidationError, ForbiddenError, NotFoundError } from '@/lib/utils/errors';

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

const maker  = { groupId: 'grp-1', userId: 'officer-1', role: 'treasurer' };
const checker = { groupId: 'grp-1', userId: 'officer-2', role: 'treasurer' };

// ─── Bank accounts ───────────────────────────────────────────────────────

describe('groupBankAccountsService', () => {
  it('activation by the creator is blocked (maker-checker)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'ba-1', created_by: 'officer-1', status: 'pending_approval' }] });

    await expect(groupBankAccountsService.activate(maker, 'ba-1'))
      .rejects.toBeInstanceOf(ForbiddenError);
  });

  it('activation by a second officer succeeds and records the decision', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'ba-1', created_by: 'officer-1', status: 'pending_approval' }] }) // claim
      .mockResolvedValueOnce({ rows: [] })                                                                   // recordApproval insert
      .mockResolvedValueOnce({ rows: [{ id: 'ba-1', status: 'active' }] });                                  // update

    const res = await groupBankAccountsService.activate(checker, 'ba-1');
    expect(res.status).toBe('active');

    const approvalInsert = mockQuery.mock.calls[1][0] as string;
    expect(approvalInsert).toContain('INSERT INTO settlement_approvals');
    expect(mockQuery.mock.calls[1][1]).toEqual(
      expect.arrayContaining(['bank_account', 'ba-1', 'grp-1', 'officer-2', 'approved']),
    );
  });

  it('a non-pending account cannot be activated', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(groupBankAccountsService.activate(checker, 'ba-1'))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});

// ─── Settlements ─────────────────────────────────────────────────────────

describe('settlementsService.initiate', () => {
  const input = { bankAccountId: 'ba-1', amount: 5000, idempotencyKey: 'key-1' };

  it('replays the same row for a repeated idempotency key — never a second sweep', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'set-1', status: 'pending_approval' }] });

    const res = await settlementsService.initiate(maker, input);
    expect(res.id).toBe('set-1');
    expect(mockQuery).toHaveBeenCalledTimes(1); // short-circuits before any reservation
  });

  it('refuses a bank account that is not active', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                                          // no existing row
      .mockResolvedValueOnce({ rows: [{ id: 'ba-1', status: 'pending_approval' }] }); // bank not active

    await expect(settlementsService.initiate(maker, input))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses when the reserved amount would exceed available balance', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'ba-1', status: 'active' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'acct-1', balance: '6000.00', reserved_amount: '2000.00' }] });

    // available = 4000, requested 5000
    await expect(settlementsService.initiate(maker, input))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('reserves the funds before the row is even approved', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'ba-1', status: 'active' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'acct-1', balance: '10000.00', reserved_amount: '0.00' }] })
      .mockResolvedValueOnce({ rows: [] })                                     // adjust_account_reserved_amount
      .mockResolvedValueOnce({ rows: [{ id: 'set-1', status: 'pending_approval' }] });

    const res = await settlementsService.initiate(maker, input);
    expect(res.status).toBe('pending_approval');

    const reserveCall = mockQuery.mock.calls[3];
    expect(reserveCall[0]).toContain('adjust_account_reserved_amount');
    expect(reserveCall[1]).toEqual(['acct-1', '5000.00']); // positive = reserve
  });

  it('rejects a non-positive amount before touching the DB', async () => {
    await expect(settlementsService.initiate(maker, { ...input, amount: 0 }))
      .rejects.toBeInstanceOf(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('settlementsService.reject', () => {
  it('releases the reservation with a negative delta', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'set-1', requested_by: 'officer-1', amount: '5000.00' }] })
      .mockResolvedValueOnce({ rows: [] })                          // recordApproval
      .mockResolvedValueOnce({ rows: [{ id: 'acct-1' }] })          // lock cash account
      .mockResolvedValueOnce({ rows: [] })                          // adjust (release)
      .mockResolvedValueOnce({ rows: [{ id: 'set-1', status: 'rejected' }] });

    await settlementsService.reject(checker, 'set-1', 'wrong account');

    const releaseCall = mockQuery.mock.calls[3];
    expect(releaseCall[0]).toContain('adjust_account_reserved_amount');
    expect(releaseCall[1]).toEqual(['acct-1', '-5000.00']); // negative = release
  });

  it('the requester cannot reject their own settlement', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'set-1', requested_by: 'officer-1', amount: '5000.00' }] });

    await expect(settlementsService.reject(maker, 'set-1', 'changed my mind'))
      .rejects.toBeInstanceOf(ForbiddenError);
  });
});

// ─── Vendor payments ─────────────────────────────────────────────────────

describe('vendorPaymentsService.initiate', () => {
  const b2c = {
    channel: 'b2c' as const, payeeName: 'Acme', payeePhone: '254712345678',
    amount: 1000, idempotencyKey: 'vk-1',
  };
  const b2b = {
    channel: 'b2b' as const, payeeName: 'Acme', payeeShortcode: '247247',
    payeeAccount: 'ACC-9', amount: 1000, idempotencyKey: 'vk-2',
  };

  it('requires a phone for the b2c channel', async () => {
    await expect(vendorPaymentsService.initiate(maker, { ...b2c, payeePhone: undefined }))
      .rejects.toBeInstanceOf(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('requires a shortcode and account for the b2b channel', async () => {
    await expect(vendorPaymentsService.initiate(maker, { ...b2b, payeeAccount: undefined }))
      .rejects.toBeInstanceOf(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects an expense account missing from the group chart AT CREATION TIME', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // no existing idempotency row
      .mockResolvedValueOnce({ rows: [] }); // account lookup → not found

    await expect(vendorPaymentsService.initiate(maker, { ...b2c, expenseAccountCode: '9999' }))
      .rejects.toBeInstanceOf(ValidationError);

    // Must fail BEFORE any funds are reserved.
    const calls = mockQuery.mock.calls.map((c) => String(c[0]));
    expect(calls.some((q) => q.includes('adjust_account_reserved_amount'))).toBe(false);
  });

  it('defaults the expense account to 5001 when not supplied', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ account_code: '5001' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'acct-1', balance: '10000.00', reserved_amount: '0.00' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'vp-1', status: 'pending_approval' }] });

    await vendorPaymentsService.initiate(maker, b2c);
    expect(mockQuery.mock.calls[1][1]).toEqual(['grp-1', '5001']);
  });

  it('replays the same row for a repeated idempotency key', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'vp-1', status: 'pending_approval' }] });

    const res = await vendorPaymentsService.initiate(maker, b2c);
    expect(res.id).toBe('vp-1');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe('vendorPaymentsService.reject', () => {
  it('the requester cannot reject their own payment', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'vp-1', requested_by: 'officer-1', amount: '1000.00' }] });

    await expect(vendorPaymentsService.reject(maker, 'vp-1', 'not needed'))
      .rejects.toBeInstanceOf(ForbiddenError);
  });

  it('releases the reservation on rejection', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'vp-1', requested_by: 'officer-1', amount: '1000.00' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'acct-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'vp-1', status: 'rejected' }] });

    await vendorPaymentsService.reject(checker, 'vp-1', 'duplicate invoice');
    expect(mockQuery.mock.calls[3][1]).toEqual(['acct-1', '-1000.00']);
  });
});
