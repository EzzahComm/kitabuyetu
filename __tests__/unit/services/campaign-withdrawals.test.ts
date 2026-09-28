/**
 * Changi$ha campaign withdrawals — same money-safety properties as the
 * settlements/vendor-payments family (__tests__/unit/services/settlements-vendor-payments.test.ts):
 * idempotency replay, reservation-before-approval, and reservation release
 * on rejection. Plus the two checks unique to this flow: the campaign's own
 * undrawn-balance gate (on top of the group cash gate) and the
 * gross/platformFee/mpesaCharge/net arithmetic.
 *
 * request()'s query sequence: idempotency lookup -> campaign FOR UPDATE ->
 * drawn-so-far SUM -> lock_group_cash_account -> resolvePolicy(min) ->
 * resolvePolicy(fee %) -> computeB2CCharge -> adjust_account_reserved_amount
 * -> INSERT campaign_withdrawals -> INSERT audit_logs.
 */
import { withTransaction, withDb } from '@/lib/db';
import { campaignWithdrawalsService } from '@/lib/services/campaign-withdrawals.service';
import { ValidationError, NotFoundError } from '@/lib/utils/errors';

jest.mock('@/lib/db', () => ({
  withDb: jest.fn(),
  withTransaction: jest.fn(),
  withAdminDb: jest.fn(),
}));
jest.mock('@/lib/queue/qstash', () => ({ triggerDisbursementWatchdog: jest.fn() }));

const mockQuery = jest.fn();
const mockClient = { query: mockQuery };

beforeEach(() => {
  mockQuery.mockReset();
  (withTransaction as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
  (withDb as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
});

const ctx = { groupId: 'grp-1', userId: 'officer-1', role: 'treasurer' };

describe('campaignWithdrawalsService.request', () => {
  const input = { campaignId: 'camp-1', grossAmount: 1000, idempotencyKey: 'wk-1' };

  it('rejects a non-positive amount before touching the DB', async () => {
    await expect(campaignWithdrawalsService.request(ctx, { ...input, grossAmount: 0 })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('requires an idempotency key before touching the DB', async () => {
    await expect(
      campaignWithdrawalsService.request(ctx, { ...input, idempotencyKey: '' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('replays the same row for a repeated idempotency key — never a second reservation', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'cw-1', status: 'pending_approval' }] });

    const res = await campaignWithdrawalsService.request(ctx, input);
    expect(res.id).toBe('cw-1');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('rejects when the campaign is not active', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // no existing idempotency row
      .mockResolvedValueOnce({ rows: [{ status: 'draft', payout_phone: '254712345678', amount_raised: '5000.00' }] });

    await expect(campaignWithdrawalsService.request(ctx, input)).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects when the campaign has no payout phone set', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ status: 'active', payout_phone: null, amount_raised: '5000.00' }] });

    await expect(campaignWithdrawalsService.request(ctx, input)).rejects.toBeInstanceOf(ValidationError);
  });

  it('a missing campaign is a NotFoundError, not a ValidationError', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });

    await expect(campaignWithdrawalsService.request(ctx, input)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects when the amount exceeds the campaign’s own undrawn balance', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ status: 'active', payout_phone: '254712345678', amount_raised: '1000.00' }] })
      // already drawn 900 -> only 100 left, requesting 1000
      .mockResolvedValueOnce({ rows: [{ drawn: '900.00' }] });

    await expect(campaignWithdrawalsService.request(ctx, input)).rejects.toBeInstanceOf(ValidationError);

    // Must fail before ever touching the group's shared cash account —
    // this check is campaign-scoped and should short-circuit first.
    const calls = mockQuery.mock.calls.map((c) => String(c[0]));
    expect(calls.some((q) => q.includes('lock_group_cash_account'))).toBe(false);
  });

  it('rejects when the amount exceeds available GROUP cash, even if the campaign has enough raised', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ status: 'active', payout_phone: '254712345678', amount_raised: '10000.00' }] })
      .mockResolvedValueOnce({ rows: [{ drawn: '0.00' }] })
      // group's pooled 1001 account only has 500 available
      .mockResolvedValueOnce({ rows: [{ id: 'acct-1', balance: '500.00', reserved_amount: '0.00' }] });

    await expect(campaignWithdrawalsService.request(ctx, input)).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an amount below the configured minimum', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ status: 'active', payout_phone: '254712345678', amount_raised: '10000.00' }] })
      .mockResolvedValueOnce({ rows: [{ drawn: '0.00' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'acct-1', balance: '10000.00', reserved_amount: '0.00' }] })
      // resolvePolicy(min_withdrawal_amount) — set above the requested 1000
      .mockResolvedValueOnce({ rows: [{ value: 2000 }] });

    await expect(campaignWithdrawalsService.request(ctx, input)).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects when fees would consume the entire withdrawal (net <= 0)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ status: 'active', payout_phone: '254712345678', amount_raised: '10000.00' }] })
      .mockResolvedValueOnce({ rows: [{ drawn: '0.00' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'acct-1', balance: '10000.00', reserved_amount: '0.00' }] })
      .mockResolvedValueOnce({ rows: [{ value: 100 }] }) // min withdrawal
      .mockResolvedValueOnce({ rows: [{ value: 90 }] }) // platform fee % — 90% of 1000 = 900
      .mockResolvedValueOnce({ rows: [{ charge: '150.00' }] }); // mpesa charge — 900 + 150 > 1000

    await expect(campaignWithdrawalsService.request(ctx, input)).rejects.toBeInstanceOf(ValidationError);

    // Must fail before ever reserving funds.
    const calls = mockQuery.mock.calls.map((c) => String(c[0]));
    expect(calls.some((q) => q.includes('adjust_account_reserved_amount'))).toBe(false);
  });

  it('reserves gross_amount (not net_amount) and stores the full fee breakdown', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ status: 'active', payout_phone: '254712345678', amount_raised: '10000.00' }] })
      .mockResolvedValueOnce({ rows: [{ drawn: '0.00' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'acct-1', balance: '10000.00', reserved_amount: '0.00' }] })
      .mockResolvedValueOnce({ rows: [{ value: 100 }] }) // min withdrawal
      .mockResolvedValueOnce({ rows: [{ value: 4 }] }) // platform fee % — 4% of 1000 = 40
      .mockResolvedValueOnce({ rows: [{ charge: '33.00' }] }) // mpesa charge
      .mockResolvedValueOnce({ rows: [] }) // adjust_account_reserved_amount
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'cw-1',
            status: 'pending_approval',
            gross_amount: '1000.00',
            platform_fee_amount: '40.00',
            mpesa_charge_amount: '33.00',
            net_amount: '927.00',
          },
        ],
      }); // INSERT

    const res = await campaignWithdrawalsService.request(ctx, input);
    expect(res.net_amount).toBe('927.00');

    const reserveCall = mockQuery.mock.calls[7];
    expect(reserveCall[0]).toContain('adjust_account_reserved_amount');
    expect(reserveCall[1]).toEqual(['acct-1', '1000.00']); // reserves the GROSS amount, not net

    const insertCall = mockQuery.mock.calls[8];
    expect(insertCall[0]).toContain('INSERT INTO campaign_withdrawals');
    expect(insertCall[1]).toEqual([
      'camp-1',
      'grp-1',
      '254712345678',
      '1000.00', // gross
      '4.00', // platform_fee_pct
      '40.00', // platform_fee_amount
      '33.00', // mpesa_charge_amount
      '927.00', // net_amount
      'officer-1',
      'wk-1',
    ]);
  });
});

describe('campaignWithdrawalsService.reject', () => {
  it('a non-pending withdrawal cannot be rejected', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(campaignWithdrawalsService.reject(ctx, 'cw-1', 'changed my mind')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('releases the gross reservation on rejection', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 'cw-1', requested_by: 'officer-2', status: 'pending_approval', gross_amount: '1000.00' }],
      })
      .mockResolvedValueOnce({ rows: [] }) // recordApproval
      .mockResolvedValueOnce({ rows: [{ id: 'acct-1' }] }) // lock cash account
      .mockResolvedValueOnce({ rows: [] }) // adjust (release)
      .mockResolvedValueOnce({ rows: [{ id: 'cw-1', status: 'rejected' }] })
      .mockResolvedValueOnce({ rows: [] }); // audit log

    await campaignWithdrawalsService.reject(ctx, 'cw-1', 'duplicate request');

    const releaseCall = mockQuery.mock.calls[3];
    expect(releaseCall[0]).toContain('adjust_account_reserved_amount');
    expect(releaseCall[1]).toEqual(['acct-1', '-1000.00']);
  });
});
