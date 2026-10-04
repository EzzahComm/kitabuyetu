/**
 * Officer notices for Changi$ha withdrawals: who is told what, through the
 * shared notifyMember path, and that a failure never breaks the workflow.
 */
import { withAdminDb } from '@/lib/db';
import { notifyMember } from '@/lib/services/notifications.service';
import { notifyWithdrawalOfficers } from '@/lib/services/campaign-officer-notices.service';

jest.mock('@/lib/db', () => ({ withAdminDb: jest.fn() }));
jest.mock('@/lib/services/notifications.service', () => ({ notifyMember: jest.fn() }));

const mockQuery = jest.fn();
const withdrawal = {
  id: 'abcdef12-0000-0000-0000-000000000000',
  group_id: 'grp-1',
  gross_amount: '1000.00',
  net_amount: '927.00',
  campaign_title: 'Water for Kianjege',
};

beforeEach(() => {
  mockQuery.mockReset();
  (notifyMember as jest.Mock).mockReset().mockResolvedValue({ channel: 'sms', status: 'sent' });
  (withAdminDb as jest.Mock).mockImplementation((fn) => fn({ query: mockQuery }));
});

it('tells only the named offices that their approval is needed, with a title and reference', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [withdrawal] }).mockResolvedValueOnce({
    rows: [
      { member_id: 'm-chair', phone: '254711111111' },
      { member_id: 'm-sec', phone: '254722222222' },
    ],
  });

  await notifyWithdrawalOfficers(withdrawal.id, {
    kind: 'approval_needed',
    requestedByRole: 'treasurer',
    offices: ['chairperson', 'secretary'],
  });

  expect(mockQuery.mock.calls[1][1][1]).toEqual(['chairperson', 'secretary']);
  expect(notifyMember).toHaveBeenCalledTimes(2);
  expect(notifyMember).toHaveBeenCalledWith(
    expect.objectContaining({
      groupId: 'grp-1',
      memberId: 'm-chair',
      title: 'Withdrawal needs your approval',
      referenceType: 'campaign_withdrawal',
      referenceId: withdrawal.id,
      notificationType: 'campaign_withdrawal.approval_needed',
      body: expect.stringContaining('WD-ABCDEF12'),
    }),
  );
});

it('sends outcome notices to all three offices', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [withdrawal] }).mockResolvedValueOnce({
    rows: [{ member_id: 'm-1', phone: '254711111111' }],
  });
  await notifyWithdrawalOfficers(withdrawal.id, { kind: 'completed', receipt: 'RFT123' });
  expect(mockQuery.mock.calls[1][1][1]).toEqual(['chairperson', 'treasurer', 'secretary']);
  expect(notifyMember).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining('RFT123') }));
});

it('skips officers without a phone number', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [withdrawal] }).mockResolvedValueOnce({
    rows: [{ member_id: 'm-1', phone: null }],
  });
  await notifyWithdrawalOfficers(withdrawal.id, { kind: 'with_platform' });
  expect(notifyMember).not.toHaveBeenCalled();
});

it('does nothing for an unknown withdrawal', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  await notifyWithdrawalOfficers(withdrawal.id, { kind: 'with_platform' });
  expect(notifyMember).not.toHaveBeenCalled();
});

it('never throws when the lookup or the send fails', async () => {
  mockQuery.mockRejectedValueOnce(new Error('db down'));
  await expect(notifyWithdrawalOfficers(withdrawal.id, { kind: 'released' })).resolves.toBeUndefined();
});
