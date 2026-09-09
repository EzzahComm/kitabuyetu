/**
 * Reallocation correction flow — maker-checker guards (ADR-20) and the
 * threshold decision (§15.5):
 *   - below threshold: executes immediately under single control
 *   - above threshold: parks pending_approval, nothing executes
 *   - the initiator can never approve their own correction
 *   - same-member / non-completed / cash corrections are rejected up front
 */
import { withTransaction } from '@/lib/db';
import { reallocationsService } from '@/lib/services/reallocations.service';
import { ValidationError, ForbiddenError } from '@/lib/utils/errors';

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

const ctx = { groupId: 'grp-1', userId: 'treasurer-1', role: 'treasurer' };

const membershipRow = { rows: [{ id: 'gm-to', member_code: 'KY000000000002' }] };
const contribution = (over: Record<string, unknown> = {}) => ({
  rows: [{
    id: 'contrib-1', group_id: 'grp-1', member_id: 'member-a',
    group_membership_id: 'gm-from', amount: '5000.00', status: 'completed',
    payment_id: 'pay-1', mpesa_receipt_number: 'RX123', journal_entry_id: null,
    ...over,
  }],
});
const paymentAllocated = { rows: [{ id: 'pay-1', allocation_status: 'allocated' }] };

describe('reallocationsService.initiate', () => {
  const input = { contributionId: 'contrib-1', toMemberId: 'member-b', reason: 'Posted to wrong member' };

  it('rejects when the contribution already belongs to the target member', async () => {
    mockQuery.mockResolvedValueOnce(membershipRow);                       // guard
    mockQuery.mockResolvedValueOnce(contribution({ member_id: 'member-b' }));

    await expect(reallocationsService.initiate(ctx, input)).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects cash/manual contributions (no linked payment)', async () => {
    mockQuery.mockResolvedValueOnce(membershipRow);
    mockQuery.mockResolvedValueOnce(contribution({ payment_id: null }));

    await expect(reallocationsService.initiate(ctx, input)).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects non-completed contributions', async () => {
    mockQuery.mockResolvedValueOnce(membershipRow);
    mockQuery.mockResolvedValueOnce(contribution({ status: 'cancelled' }));

    await expect(reallocationsService.initiate(ctx, input)).rejects.toBeInstanceOf(ValidationError);
  });

  it('parks above-threshold corrections pending approval without executing', async () => {
    mockQuery.mockResolvedValueOnce(membershipRow);
    mockQuery.mockResolvedValueOnce(contribution({ amount: '50000.00' }));
    mockQuery.mockResolvedValueOnce(paymentAllocated);
    mockQuery.mockResolvedValueOnce({ rows: [{ threshold: '10000.00' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'realloc-1', status: 'pending_approval' }] });

    const result = await reallocationsService.initiate(ctx, input);

    expect(result.needsApproval).toBe(true);
    // INSERT was the last query — no execution steps followed.
    expect(mockQuery).toHaveBeenCalledTimes(5);
    expect(mockQuery.mock.calls[4][1]).toContain('pending_approval');
  });

  it('executes below-threshold corrections immediately', async () => {
    mockQuery.mockResolvedValueOnce(membershipRow);
    mockQuery.mockResolvedValueOnce(contribution({ amount: '5000.00' }));
    mockQuery.mockResolvedValueOnce(paymentAllocated);
    mockQuery.mockResolvedValueOnce({ rows: [{ threshold: '10000.00' }] });
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'realloc-1', status: 'executed', payment_id: 'pay-1',
        from_group_id: 'grp-1', from_member_id: 'member-a', from_domain_id: 'contrib-1',
        to_group_id: 'grp-1', to_member_id: 'member-b', to_group_membership_id: 'gm-to',
        reason: input.reason, initiated_by: 'treasurer-1',
      }],
    });
    // executeReallocation (original had no journal → mirrors skipped):
    mockQuery.mockResolvedValueOnce(contribution());                  // void original RETURNING
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'contrib-2' }] }); // corrected insert
    mockQuery.mockResolvedValueOnce({ rows: [] });                    // spine transition
    mockQuery.mockResolvedValueOnce({ rows: [] });                    // payment_events
    mockQuery.mockResolvedValueOnce({ rows: [] });                    // outbox
    mockQuery.mockResolvedValueOnce({ rows: [] });                    // realloc finalise

    const result = await reallocationsService.initiate(ctx, input);

    expect(result.needsApproval).toBe(false);
    expect(mockQuery).toHaveBeenCalledTimes(11);
    // Void step targets only completed rows (double-execution latch).
    expect(mockQuery.mock.calls[5][0]).toContain("status = 'completed'");
    // Spine flips to reallocated.
    expect(mockQuery.mock.calls[7][0]).toContain("allocation_status = 'reallocated'");
  });
});

describe('reallocationsService.approve', () => {
  it('refuses approval by the initiator (maker-checker)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'realloc-1', status: 'pending_approval', initiated_by: 'treasurer-1' }],
    });

    await expect(reallocationsService.approve(ctx, 'realloc-1'))
      .rejects.toBeInstanceOf(ForbiddenError);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('lets a different officer approve and execute', async () => {
    const approverCtx = { ...ctx, userId: 'chair-1', role: 'chairperson' };
    const realloc = {
      id: 'realloc-1', status: 'pending_approval', initiated_by: 'treasurer-1',
      payment_id: 'pay-1', from_group_id: 'grp-1', from_member_id: 'member-a',
      from_domain_id: 'contrib-1', to_group_id: 'grp-1', to_member_id: 'member-b',
      to_group_membership_id: 'gm-to', reason: 'wrong member',
    };
    mockQuery.mockResolvedValueOnce({ rows: [realloc] });                        // FOR UPDATE
    mockQuery.mockResolvedValueOnce({ rows: [{ ...realloc, status: 'executed' }] }); // approve UPDATE
    mockQuery.mockResolvedValueOnce(                                             // void original
      { rows: [{ id: 'contrib-1', group_id: 'grp-1', member_id: 'member-a',
                 group_membership_id: 'gm-from', amount: '50000.00',
                 contribution_date: new Date(), payment_method: 'mpesa',
                 mpesa_receipt_number: 'RX123', journal_entry_id: null }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'contrib-2' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await reallocationsService.approve(approverCtx, 'realloc-1');
    expect(result.status).toBe('executed');
    // Approval stamps the second officer.
    expect(mockQuery.mock.calls[1][1]).toEqual(['realloc-1', 'chair-1']);
  });
});
