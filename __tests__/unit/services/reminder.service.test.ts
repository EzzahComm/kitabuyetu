/**
 * Platform-wide reminder idempotency (lib/services/reminder.service.ts) —
 * built after notify_loan_due_alerts was found re-sending the same SMS every
 * single day a pending installment stayed within its due window, since the
 * cron scanner had no memory of past sends. These tests exercise the claim/
 * settle state machine in isolation (mocked DB + mocked notifyMember) —
 * the real DB behavior (the UNIQUE constraint that makes the claim atomic)
 * is proven separately by CI's db-integration suite applying migration 106.
 */
import { sendOnce, type ReminderInput } from '@/lib/services/reminder.service';
import { notifyMember } from '@/lib/services/notifications.service';

jest.mock('@/lib/db', () => ({
  withAdminDb: jest.fn((fn: (db: unknown) => unknown) => fn(mockClient)),
}));
jest.mock('@/lib/services/notifications.service', () => ({
  notifyMember: jest.fn(),
}));

const mockQuery  = jest.fn();
const mockClient = { query: mockQuery };
const mockNotifyMember = notifyMember as jest.Mock;

const baseInput: ReminderInput = {
  groupId:       'group-1',
  memberId:      'member-1',
  phone:         '254712345678',
  body:          'Your installment is due soon.',
  referenceType: 'loan_repayment',
  referenceId:   'repayment-1',
  reminderStage: 'due_3_days',
};

beforeEach(() => {
  mockQuery.mockReset();
  mockNotifyMember.mockReset();
});

describe('sendOnce', () => {
  it('claims a fresh (reference, stage) slot and sends via notifyMember', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'dispatch-1' }] }); // INSERT claim succeeds
    mockNotifyMember.mockResolvedValueOnce({ channel: 'sms', status: 'sent' });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // settle UPDATE

    const result = await sendOnce(baseInput);

    expect(result).toEqual({ sent: true, status: 'sent' });
    expect(mockNotifyMember).toHaveBeenCalledTimes(1);
    expect(mockNotifyMember).toHaveBeenCalledWith(baseInput);

    const settleCall = mockQuery.mock.calls[1];
    expect(settleCall[0]).toMatch(/UPDATE reminder_dispatch_log/);
    expect(settleCall[1]).toEqual(['dispatch-1', 'sent', 'sms', null]);
  });

  it('does not send and does not call notifyMember when the stage was already sent', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT conflicts (already claimed)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'dispatch-1', status: 'sent' }] }); // existing row

    const result = await sendOnce(baseInput);

    expect(result).toEqual({ sent: false, status: 'already_sent' });
    expect(mockNotifyMember).not.toHaveBeenCalled();
  });

  it('does not send and does not call notifyMember when the recipient opted out on a prior attempt', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'dispatch-1', status: 'suppressed' }] });

    const result = await sendOnce(baseInput);

    expect(result).toEqual({ sent: false, status: 'already_suppressed' });
    expect(mockNotifyMember).not.toHaveBeenCalled();
  });

  it('retries a previously failed attempt for the same stage instead of abandoning it', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'dispatch-1', status: 'failed' }] });
    mockNotifyMember.mockResolvedValueOnce({ channel: 'sms', status: 'sent' });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await sendOnce(baseInput);

    expect(result).toEqual({ sent: true, status: 'sent' });
    expect(mockNotifyMember).toHaveBeenCalledTimes(1);
  });

  it('records a failed outcome without marking the stage terminal, so a later run can retry it', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'dispatch-1' }] });
    mockNotifyMember.mockResolvedValueOnce({ channel: 'sms', status: 'failed', detail: 'provider outage' });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await sendOnce(baseInput);

    expect(result).toEqual({ sent: false, status: 'failed' });
    const settleCall = mockQuery.mock.calls[1];
    expect(settleCall[1]).toEqual(['dispatch-1', 'failed', 'sms', 'provider outage']);
  });

  it('fails closed (never sends) if the claim conflicts but no existing row can be found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT conflicts
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT existing finds nothing (shouldn't happen)

    const result = await sendOnce(baseInput);

    expect(result).toEqual({ sent: false, status: 'claim_error' });
    expect(mockNotifyMember).not.toHaveBeenCalled();
  });
});
