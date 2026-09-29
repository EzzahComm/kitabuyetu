/**
 * What approve() actually sends to Daraja for each payout destination
 * (migration 202): B2C for a phone, B2B BusinessPayBill for a paybill, B2B
 * BusinessBuyGoods for a till — and that a Daraja rejection releases the
 * reservation and marks the row failed rather than leaving money held.
 *
 * approve() query sequence: [tx] SELECT FOR UPDATE -> UPDATE approved ->
 * audit; [dispatch, admin] UPDATE processing RETURNING -> audit -> SELECT
 * title -> (Daraja) -> UPDATE originator_conversation_id; [getById] SELECT.
 */
import { withAdminDb, withDb, withTransaction } from '@/lib/db';
import { campaignWithdrawalsService } from '@/lib/services/campaign-withdrawals.service';

jest.mock('@/lib/db', () => ({
  withDb: jest.fn(),
  withTransaction: jest.fn(),
  withAdminDb: jest.fn(),
}));
jest.mock('@/lib/queue/qstash', () => ({ triggerDisbursementWatchdog: jest.fn() }));
jest.mock('@/lib/services/settlement-approvals.service', () => ({ recordApproval: jest.fn() }));

const initiateB2C = jest.fn();
const initiateB2B = jest.fn();
jest.mock('@/lib/services/daraja.service', () => ({
  initiateB2C: (...args: unknown[]) => initiateB2C(...args),
  initiateB2B: (...args: unknown[]) => initiateB2B(...args),
}));

const mockQuery = jest.fn();
const mockClient = { query: mockQuery };
const ctx = { groupId: 'grp-1', userId: 'officer-1', role: 'treasurer' };

beforeEach(() => {
  mockQuery.mockReset();
  initiateB2C.mockReset().mockResolvedValue({ originatorConversationId: 'orig-b2c' });
  initiateB2B.mockReset().mockResolvedValue({ originatorConversationId: 'orig-b2b' });
  (withTransaction as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
  (withDb as jest.Mock).mockImplementation((_ctx, fn) => fn(mockClient));
  (withAdminDb as jest.Mock).mockImplementation((fn) => fn(mockClient));
});

const noDestination = { payout_phone: null, payout_shortcode: null, payout_account: null, payout_payee_name: null };

/** Queues the query results for approve() up to and including the dispatch claim. */
function queueApproveUpTo(claimed: Record<string, unknown>) {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: claimed.id, requested_by: 'officer-2', status: 'pending_approval' }] })
    .mockResolvedValueOnce({ rows: [{ id: claimed.id, status: 'approved' }] }) // UPDATE approved
    .mockResolvedValueOnce({ rows: [] }) // audit
    .mockResolvedValueOnce({ rows: [claimed] }) // UPDATE processing RETURNING
    .mockResolvedValueOnce({ rows: [] }) // audit
    .mockResolvedValueOnce({ rows: [{ title: 'Medical appeal' }] }); // SELECT title
}

const base = { id: 'cw-12345678-aaaa', group_id: 'grp-1', campaign_id: 'camp-1', net_amount: '927.00' };

describe('approve() dispatch by payout destination', () => {
  it('a phone destination goes out as B2C BusinessPayment', async () => {
    queueApproveUpTo({ ...base, ...noDestination, payout_method: 'phone', payout_phone: '254712345678' });
    mockQuery.mockResolvedValue({ rows: [{ id: base.id, status: 'processing' }] }); // originator + getById

    await campaignWithdrawalsService.approve(ctx, base.id);

    expect(initiateB2B).not.toHaveBeenCalled();
    expect(initiateB2C).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '254712345678', amount: 927, commandId: 'BusinessPayment' }),
    );
    expect(mockQuery.mock.calls[6][1]).toEqual([base.id, 'orig-b2c']);
  });

  it('a paybill destination goes out as B2B BusinessPayBill with the business’s account number', async () => {
    queueApproveUpTo({
      ...base,
      ...noDestination,
      payout_method: 'paybill',
      payout_shortcode: '247247',
      payout_account: 'PAT-00123',
      payout_payee_name: 'Kenyatta National Hospital',
    });
    mockQuery.mockResolvedValue({ rows: [{ id: base.id, status: 'processing' }] });

    await campaignWithdrawalsService.approve(ctx, base.id);

    expect(initiateB2C).not.toHaveBeenCalled();
    expect(initiateB2B).toHaveBeenCalledWith({
      amount: 927,
      receiverShortcode: '247247',
      receiverIdentifier: '4',
      commandId: 'BusinessPayBill',
      accountReference: 'PAT-00123',
      remarks: 'Changi$ha withdrawal — Medical appeal',
    });
    // The B2B OriginatorConversationID is what the B2B result callback correlates on.
    expect(mockQuery.mock.calls[6][1]).toEqual([base.id, 'orig-b2b']);
  });

  it('a till destination goes out as B2B BusinessBuyGoods with a traceable reference', async () => {
    queueApproveUpTo({
      ...base,
      ...noDestination,
      payout_method: 'till',
      payout_shortcode: '5432109',
      payout_payee_name: 'Umoja Funeral Services',
    });
    mockQuery.mockResolvedValue({ rows: [{ id: base.id, status: 'processing' }] });

    await campaignWithdrawalsService.approve(ctx, base.id);

    expect(initiateB2B).toHaveBeenCalledWith(
      expect.objectContaining({
        receiverShortcode: '5432109',
        commandId: 'BusinessBuyGoods',
        accountReference: 'CHANGISHA-cw-12345',
      }),
    );
    const [call] = initiateB2B.mock.calls;
    expect(call[0].accountReference.length).toBeLessThanOrEqual(20); // never truncated by Daraja
  });

  it('a Daraja rejection releases the gross reservation and marks the row failed', async () => {
    queueApproveUpTo({
      ...base,
      ...noDestination,
      payout_method: 'paybill',
      payout_shortcode: '247247',
      payout_account: 'PAT-00123',
      payout_payee_name: 'Kenyatta National Hospital',
    });
    initiateB2B.mockRejectedValueOnce(new Error('B2B product not enabled on shortcode'));
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'acct-1' }] }) // lock_group_cash_account
      .mockResolvedValueOnce({ rows: [{ gross_amount: '1000.00' }] }) // re-read gross
      .mockResolvedValueOnce({ rows: [] }) // adjust (release)
      .mockResolvedValueOnce({ rows: [] }) // UPDATE failed
      .mockResolvedValueOnce({ rows: [{ id: base.id, status: 'failed' }] }); // getById

    const row = await campaignWithdrawalsService.approve(ctx, base.id);

    expect(row.status).toBe('failed');
    const release = mockQuery.mock.calls.find((c) => String(c[0]).includes('adjust_account_reserved_amount'));
    expect(release?.[1]).toEqual(['acct-1', '-1000.00']);
    const failed = mockQuery.mock.calls.find((c) => String(c[0]).includes("status = 'failed'"));
    expect(failed?.[1][1]).toContain('B2B product not enabled on shortcode');
  });
});
