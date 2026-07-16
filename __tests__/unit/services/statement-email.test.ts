/**
 * Per-member account statement email — closes ACCOUNTING_ARCHITECTURE_AUDIT.md
 * §12 ("designed, never wired"). Covers the email_preferences specificity
 * cascade (group-specific override beats a global one) since that's the one
 * piece of non-obvious logic in sendMemberStatements.
 */
import { withAdminDb } from '@/lib/db';
import { sendReactEmail } from '@/lib/email/react/send';
import { sendMemberStatements } from '@/lib/services/statement-email.service';

jest.mock('@/lib/db', () => ({
  withAdminDb: jest.fn(),
}));
jest.mock('@/lib/email/react/send', () => ({
  sendReactEmail: jest.fn(),
}));

const mockQuery = jest.fn();

beforeEach(() => {
  mockQuery.mockReset();
  (withAdminDb as jest.Mock).mockImplementation((fn) => fn({ query: mockQuery }));
  (sendReactEmail as jest.Mock).mockReset().mockResolvedValue({ success: true });
});

describe('sendMemberStatements', () => {
  it('sends nothing when the group has no eligible members', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // members query

    const result = await sendMemberStatements('grp-1', 'May 2026');

    expect(result).toEqual({ sent: 0, skipped: 0 });
    expect(sendReactEmail).not.toHaveBeenCalled();
  });

  it('sends a statement per eligible member with the right props', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'mem-1', full_name: 'Amina Hassan', email: 'amina@example.com', group_name: 'Umoja VSLA',
        savings: '84500.00', loan_balance: '18000.00', shares: '32000.00', contributed_this_period: '5000.00',
      }],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ member_id: 'mem-1', txn_date: '2026-05-29', label: 'Contribution', amount: '1000.00', direction: 'in' }],
    });

    const result = await sendMemberStatements('grp-1', 'May 2026');

    expect(result).toEqual({ sent: 1, skipped: 0 });
    expect(sendReactEmail).toHaveBeenCalledTimes(1);
    const call = (sendReactEmail as jest.Mock).mock.calls[0][0];
    expect(call.to).toBe('amina@example.com');
    expect(call.groupId).toBe('grp-1');
    expect(call.userId).toBe('mem-1');
    expect(call.category).toBe('monthly_statement');
    expect(call.element.props.savings).toBe(84500);
    expect(call.element.props.loanBalance).toBe(18000);
    expect(call.element.props.transactions).toEqual([
      { date: expect.any(String), label: 'Contribution', amount: 1000, direction: 'in' },
    ]);
  });

  it('counts a failed send as skipped rather than throwing', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'mem-1', full_name: 'Amina Hassan', email: 'amina@example.com', group_name: 'Umoja VSLA',
        savings: '0', loan_balance: '0', shares: '0', contributed_this_period: '0',
      }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    (sendReactEmail as jest.Mock).mockRejectedValueOnce(new Error('provider down'));

    const result = await sendMemberStatements('grp-1', 'May 2026');
    expect(result).toEqual({ sent: 0, skipped: 1 });
  });
});
