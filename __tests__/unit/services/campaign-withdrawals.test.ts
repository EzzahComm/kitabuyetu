/**
 * Changi$ha campaign withdrawals — same money-safety properties as the
 * settlements/vendor-payments family (__tests__/unit/services/settlements-vendor-payments.test.ts):
 * idempotency replay, reservation-before-approval, and reservation release
 * on rejection. Plus the two checks unique to this flow: the campaign's own
 * undrawn-balance gate (on top of the group cash gate) and the
 * gross/platformFee/mpesaCharge/net arithmetic.
 *
 * request()'s query sequence: idempotency lookup -> (officer checks, mocked) -> campaign FOR UPDATE ->
 * drawn-so-far SUM -> lock_group_cash_account -> resolvePolicy(min) ->
 * resolvePolicy(fee %) -> computeB2CCharge -> adjust_account_reserved_amount
 * -> INSERT campaign_withdrawals -> INSERT audit_logs.
 */
import { withTransaction, withDb, withAdminDb } from '@/lib/db';
import { campaignWithdrawalsService } from '@/lib/services/campaign-withdrawals.service';
import {
  assertCampaignOfficersComplete,
  CampaignOfficersIncompleteError,
  getApprovedOfficerRoles,
  getApprovedOfficerRolesBySubject,
  getOfficerRole,
} from '@/lib/services/campaign-officers.service';
import { ConflictError, ForbiddenError, ValidationError, NotFoundError } from '@/lib/utils/errors';

jest.mock('@/lib/db', () => ({
  withDb: jest.fn(),
  withTransaction: jest.fn(),
  withAdminDb: jest.fn(),
}));
jest.mock('@/lib/queue/qstash', () => ({ triggerDisbursementWatchdog: jest.fn() }));

jest.mock('@/lib/services/campaign-officers.service', () => ({
  ...jest.requireActual('@/lib/services/campaign-officers.service'),
  assertCampaignOfficersComplete: jest.fn(),
  getOfficerRole: jest.fn(),
  getApprovedOfficerRoles: jest.fn(),
  getApprovedOfficerRolesBySubject: jest.fn(),
}));

const mockQuery = jest.fn();
const mockClient = { query: mockQuery };

beforeEach(() => {
  mockQuery.mockReset();
  (assertCampaignOfficersComplete as jest.Mock).mockReset().mockResolvedValue(undefined);
  (getOfficerRole as jest.Mock).mockReset().mockResolvedValue('treasurer');
  (getApprovedOfficerRoles as jest.Mock).mockReset().mockResolvedValue([]);
  (getApprovedOfficerRolesBySubject as jest.Mock).mockReset().mockResolvedValue(new Map());
  (withTransaction as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
  (withDb as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
  (withAdminDb as jest.Mock).mockImplementation((fn) => fn(mockClient));
});

const ctx = { groupId: 'grp-1', userId: 'officer-1', role: 'treasurer' };

/** An active campaign paying out to a phone, as the DB returns it (migration 202 columns included). */
const activePhone = {
  status: 'active',
  payout_method: 'phone',
  payout_phone: '254712345678',
  payout_shortcode: null,
  payout_account: null,
  payout_payee_name: null,
};

describe('campaignWithdrawalsService.request', () => {
  const input = { campaignId: 'camp-1', grossAmount: 1000, idempotencyKey: 'wk-1' };

  it('refuses a group without all three offices filled — nothing is reserved', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no idempotency row
    (assertCampaignOfficersComplete as jest.Mock).mockRejectedValueOnce(
      new CampaignOfficersIncompleteError(['secretary']),
    );
    await expect(campaignWithdrawalsService.request(ctx, input)).rejects.toBeInstanceOf(
      CampaignOfficersIncompleteError,
    );
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('refuses a requester who is not the chairperson, treasurer or secretary', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    (getOfficerRole as jest.Mock).mockResolvedValueOnce(null);
    await expect(campaignWithdrawalsService.request(ctx, input)).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-positive amount before touching the DB', async () => {
    await expect(campaignWithdrawalsService.request(ctx, { ...input, grossAmount: 0 })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('requires an idempotency key before touching the DB', async () => {
    await expect(campaignWithdrawalsService.request(ctx, { ...input, idempotencyKey: '' })).rejects.toBeInstanceOf(
      ValidationError,
    );
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
      .mockResolvedValueOnce({ rows: [{ ...activePhone, status: 'draft', amount_raised: '5000.00' }] });

    await expect(campaignWithdrawalsService.request(ctx, input)).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects when the campaign has no payout destination set', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...activePhone, payout_phone: null, amount_raised: '5000.00' }] });

    await expect(campaignWithdrawalsService.request(ctx, input)).rejects.toBeInstanceOf(ValidationError);
  });

  it('a missing campaign is a NotFoundError, not a ValidationError', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });

    await expect(campaignWithdrawalsService.request(ctx, input)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects when the amount exceeds the campaign’s own undrawn balance', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...activePhone, amount_raised: '1000.00' }] })
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
      .mockResolvedValueOnce({ rows: [{ ...activePhone, amount_raised: '10000.00' }] })
      .mockResolvedValueOnce({ rows: [{ drawn: '0.00' }] })
      // group's pooled 1001 account only has 500 available
      .mockResolvedValueOnce({ rows: [{ id: 'acct-1', balance: '500.00', reserved_amount: '0.00' }] });

    await expect(campaignWithdrawalsService.request(ctx, input)).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an amount below the configured minimum', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...activePhone, amount_raised: '10000.00' }] })
      .mockResolvedValueOnce({ rows: [{ drawn: '0.00' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'acct-1', balance: '10000.00', reserved_amount: '0.00' }] })
      // resolvePolicy(min_withdrawal_amount) — set above the requested 1000
      .mockResolvedValueOnce({ rows: [{ value: 2000 }] });

    await expect(campaignWithdrawalsService.request(ctx, input)).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects when fees would consume the entire withdrawal (net <= 0)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...activePhone, amount_raised: '10000.00' }] })
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
      .mockResolvedValueOnce({ rows: [{ ...activePhone, amount_raised: '10000.00' }] })
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

    const chargeCall = mockQuery.mock.calls[6];
    expect(chargeCall[0]).toContain("mpesa_charge_for_amount($1, 'b2c')"); // phone -> B2C tariff

    const insertCall = mockQuery.mock.calls[8];
    expect(insertCall[0]).toContain('INSERT INTO campaign_withdrawals');
    expect(insertCall[0]).toContain('platform_signoff_required'); // always true: Kitabu Yetu signs off every release
    expect(insertCall[1]).toEqual([
      'camp-1',
      'grp-1',
      'phone', // payout_method
      '254712345678', // payout_phone
      null, // payout_shortcode
      null, // payout_account
      null, // payout_payee_name
      '1000.00', // gross
      '4.00', // platform_fee_pct
      '40.00', // platform_fee_amount
      '33.00', // mpesa_charge_amount
      '927.00', // net_amount
      'officer-1',
      'wk-1',
      'treasurer', // requested_by_role
    ]);
  });

  it('a paybill campaign uses the B2B tariff and snapshots the business destination', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            status: 'active',
            amount_raised: '10000.00',
            payout_method: 'paybill',
            payout_phone: null,
            payout_shortcode: '247247',
            payout_account: 'PAT-00123',
            payout_payee_name: 'Kenyatta National Hospital',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ drawn: '0.00' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'acct-1', balance: '10000.00', reserved_amount: '0.00' }] })
      .mockResolvedValueOnce({ rows: [{ value: 100 }] }) // min withdrawal
      .mockResolvedValueOnce({ rows: [{ value: 4 }] }) // platform fee % — 40
      .mockResolvedValueOnce({ rows: [{ charge: '22.00' }] }) // B2B charge
      .mockResolvedValueOnce({ rows: [] }) // adjust_account_reserved_amount
      .mockResolvedValueOnce({ rows: [{ id: 'cw-2', net_amount: '938.00' }] }); // INSERT

    await campaignWithdrawalsService.request(ctx, input);

    const chargeCall = mockQuery.mock.calls[6];
    expect(chargeCall[0]).toContain("mpesa_charge_for_amount($1, 'b2b')");

    const insertCall = mockQuery.mock.calls[8];
    expect(insertCall[1].slice(2, 7)).toEqual(['paybill', null, '247247', 'PAT-00123', 'Kenyatta National Hospital']);
    expect(insertCall[1][11]).toBe('938.00'); // net = 1000 - 40 - 22
  });

  it('rejects a paybill campaign whose destination is incomplete', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [
        {
          status: 'active',
          amount_raised: '10000.00',
          payout_method: 'paybill',
          payout_phone: null,
          payout_shortcode: '247247',
          payout_account: null,
          payout_payee_name: 'Kenyatta National Hospital',
        },
      ],
    });

    await expect(campaignWithdrawalsService.request(ctx, input)).rejects.toBeInstanceOf(ValidationError);
    expect(mockQuery).toHaveBeenCalledTimes(2); // nothing reserved
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

describe('platform sign-off (Kitabu Yetu releases the funds)', () => {
  const queries = () => mockQuery.mock.calls.map((c) => String(c[0]));

  const pending = (requestedByRole: string) => ({
    rows: [{ id: 'cw-1', requested_by: 'officer-2', status: 'pending_approval', requested_by_role: requestedByRole }],
  });

  it('the last office approving moves the row to awaiting_platform and dispatches NOTHING', async () => {
    (getOfficerRole as jest.Mock).mockResolvedValue('secretary');
    (getApprovedOfficerRoles as jest.Mock).mockResolvedValue(['treasurer']); // requester is the chairperson
    mockQuery
      .mockResolvedValueOnce(pending('chairperson'))
      .mockResolvedValueOnce({ rows: [] }) // recordApproval
      .mockResolvedValueOnce({ rows: [{ id: 'cw-1', status: 'awaiting_platform' }] }) // UPDATE
      .mockResolvedValueOnce({ rows: [] }) // audit
      .mockResolvedValueOnce({ rows: [{ id: 'cw-1', status: 'awaiting_platform' }] }); // getById

    const res = await campaignWithdrawalsService.approve(ctx, 'cw-1');

    expect(res.status).toBe('awaiting_platform');
    const approvalCall = mockQuery.mock.calls[1];
    expect(approvalCall[1]).toContain('secretary'); // approval is recorded against the office
    expect(mockQuery.mock.calls[2][0]).toContain("status = 'awaiting_platform'");
    expect(queries().some((q) => q.includes("SET    status = 'processing'"))).toBe(false);
  });

  it('the first of the two other offices approving leaves the row pending', async () => {
    (getOfficerRole as jest.Mock).mockResolvedValue('secretary');
    mockQuery
      .mockResolvedValueOnce(pending('chairperson'))
      .mockResolvedValueOnce({ rows: [] }) // recordApproval
      .mockResolvedValueOnce({ rows: [] }) // audit (approve_partial)
      .mockResolvedValueOnce({ rows: [{ id: 'cw-1', status: 'pending_approval' }] }); // getById

    const res = await campaignWithdrawalsService.approve(ctx, 'cw-1');

    expect(res.status).toBe('pending_approval');
    expect(queries().some((q) => q.includes("status = 'awaiting_platform'"))).toBe(false);
    expect(mockQuery.mock.calls[2][1][2]).toBe('campaignWithdrawal.approve_partial');
  });

  it("the requester's own office cannot approve (a second treasurer does not count)", async () => {
    (getOfficerRole as jest.Mock).mockResolvedValue('chairperson');
    mockQuery.mockResolvedValueOnce(pending('chairperson'));
    await expect(campaignWithdrawalsService.approve(ctx, 'cw-1')).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockQuery).toHaveBeenCalledTimes(1); // no approval recorded
  });

  it('an office that has already approved cannot approve again', async () => {
    (getOfficerRole as jest.Mock).mockResolvedValue('treasurer');
    (getApprovedOfficerRoles as jest.Mock).mockResolvedValue(['treasurer']);
    mockQuery.mockResolvedValueOnce(pending('chairperson'));
    await expect(campaignWithdrawalsService.approve(ctx, 'cw-1')).rejects.toBeInstanceOf(ConflictError);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('a non-officer cannot approve', async () => {
    (getOfficerRole as jest.Mock).mockResolvedValue(null);
    mockQuery.mockResolvedValueOnce(pending('chairperson'));
    await expect(campaignWithdrawalsService.approve(ctx, 'cw-1')).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('nobody can approve once the group has lost one of the three offices', async () => {
    (assertCampaignOfficersComplete as jest.Mock).mockRejectedValueOnce(
      new CampaignOfficersIncompleteError(['treasurer']),
    );
    mockQuery.mockResolvedValueOnce(pending('chairperson'));
    await expect(campaignWithdrawalsService.approve(ctx, 'cw-1')).rejects.toBeInstanceOf(
      CampaignOfficersIncompleteError,
    );
  });

  it('platformApprove releases an awaiting_platform row and records a backoffice approval', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'cw-1', group_id: 'grp-1', status: 'awaiting_platform' }] }) // SELECT FOR UPDATE
      .mockResolvedValueOnce({ rows: [] }) // settlement_approvals
      .mockResolvedValueOnce({ rows: [{ id: 'cw-1', status: 'approved' }] }) // UPDATE
      .mockResolvedValueOnce({ rows: [] }) // audit
      .mockResolvedValueOnce({ rows: [] }); // dispatch claim finds nothing (already claimed) -> no Daraja call

    const res = await campaignWithdrawalsService.platformApprove('admin-1', 'cw-1');

    expect(res.status).toBe('approved');
    const [selectSql] = mockQuery.mock.calls[0];
    expect(selectSql).toContain("status = 'awaiting_platform'");
    const approvalCall = mockQuery.mock.calls[1];
    expect(approvalCall[0]).toContain("'backoffice'");
    expect(approvalCall[1]).toEqual(['cw-1', 'grp-1', 'admin-1']);
  });

  it('platformApprove refuses to release when the group no longer has all three offices', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'cw-1', group_id: 'grp-1', status: 'awaiting_platform' }] });
    (assertCampaignOfficersComplete as jest.Mock).mockRejectedValueOnce(
      new CampaignOfficersIncompleteError(['secretary']),
    );
    await expect(campaignWithdrawalsService.platformApprove('admin-1', 'cw-1')).rejects.toBeInstanceOf(
      CampaignOfficersIncompleteError,
    );
    expect(queries().some((q) => q.includes('settlement_approvals'))).toBe(false);
  });

  it('platformApprove refuses a row that is not awaiting the platform (e.g. already released)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(campaignWithdrawalsService.platformApprove('admin-1', 'cw-1')).rejects.toBeInstanceOf(NotFoundError);
    expect(queries().some((q) => q.includes('settlement_approvals'))).toBe(false);
  });

  it('platformReject returns the reserved gross to the group and closes the row', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 'cw-1', group_id: 'grp-1', status: 'awaiting_platform', gross_amount: '1000.00' }],
      })
      .mockResolvedValueOnce({ rows: [] }) // settlement_approvals
      .mockResolvedValueOnce({ rows: [{ id: 'acct-1' }] }) // lock cash account
      .mockResolvedValueOnce({ rows: [] }) // release
      .mockResolvedValueOnce({ rows: [{ id: 'cw-1', status: 'rejected' }] }) // UPDATE
      .mockResolvedValueOnce({ rows: [] }); // audit

    const res = await campaignWithdrawalsService.platformReject('admin-1', 'cw-1', 'Payee could not be verified');

    expect(res.status).toBe('rejected');
    const releaseCall = mockQuery.mock.calls[3];
    expect(releaseCall[0]).toContain('adjust_account_reserved_amount');
    expect(releaseCall[1]).toEqual(['acct-1', '-1000.00']);
    const updateCall = mockQuery.mock.calls[4];
    expect(updateCall[1]).toEqual(['cw-1', 'Declined by Kitabu Yetu: Payee could not be verified']);
  });

  it('platformReject requires a reason and touches nothing without one', async () => {
    await expect(campaignWithdrawalsService.platformReject('admin-1', 'cw-1', '  ')).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
