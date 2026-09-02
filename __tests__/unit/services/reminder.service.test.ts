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

/**
 * Find a query by its SQL rather than by index. sendOnce's call sequence is
 * claim -> cooldown lookup (G26) -> settle, and asserting on mock.calls[1]
 * silently retargeted the moment the cooldown check landed between them.
 */
function callMatching(re: RegExp): unknown[] {
  const call = mockQuery.mock.calls.find((c) => re.test(String(c[0])));
  if (!call) throw new Error(`no query matching ${re}`);
  return call;
}

/** The cooldown lookup's shape: no recent delivered reminder for this member. */
const NO_COOLDOWN = { rows: [{ exists: false }] };

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
    mockQuery.mockResolvedValueOnce(NO_COOLDOWN);                      // cooldown lookup
    mockNotifyMember.mockResolvedValueOnce({ channel: 'sms', status: 'sent' });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // settle UPDATE

    const result = await sendOnce(baseInput);

    expect(result).toEqual({ sent: true, status: 'sent' });
    expect(mockNotifyMember).toHaveBeenCalledTimes(1);
    expect(mockNotifyMember).toHaveBeenCalledWith(baseInput);

    const settleCall = callMatching(/UPDATE reminder_dispatch_log/);
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
    mockQuery.mockResolvedValueOnce(NO_COOLDOWN);
    mockNotifyMember.mockResolvedValueOnce({ channel: 'sms', status: 'sent' });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await sendOnce(baseInput);

    expect(result).toEqual({ sent: true, status: 'sent' });
    expect(mockNotifyMember).toHaveBeenCalledTimes(1);
  });

  it('records a failed outcome without marking the stage terminal, so a later run can retry it', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'dispatch-1' }] });
    mockQuery.mockResolvedValueOnce(NO_COOLDOWN);
    mockNotifyMember.mockResolvedValueOnce({ channel: 'sms', status: 'failed', detail: 'provider outage' });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await sendOnce(baseInput);

    expect(result).toEqual({ sent: false, status: 'failed' });
    const settleCall = callMatching(/UPDATE reminder_dispatch_log/);
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

/**
 * SMS-AUDIT-v3 T3-5 / G26. The (reference, stage) dedup above cannot see that
 * several DIFFERENT reminders are landing on one member at once — which is
 * exactly what happens when the monthly scanners all come due on the 1st.
 */
describe('sendOnce member cooldown', () => {
  it('defers a second reminder for the same member, without calling the provider', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'dispatch-2' }] });  // claim succeeds
    mockQuery.mockResolvedValueOnce({ rows: [{ exists: true }] });      // recently reminded

    const result = await sendOnce({ ...baseInput, reminderStage: 'a_different_stage' });

    expect(result).toEqual({ sent: false, status: 'cooldown' });
    // The point of the whole feature: no reservation, no provider call, no charge.
    expect(mockNotifyMember).not.toHaveBeenCalled();
  });

  it('leaves the claimed row resumable, so the reminder is deferred and not lost', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'dispatch-2' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ exists: true }] });

    await sendOnce(baseInput);

    // No settle: the row stays 'pending', which claim() treats as resumable.
    // Marking it terminal here would silently drop the reminder for good.
    const settled = mockQuery.mock.calls.some((c) => /UPDATE reminder_dispatch_log/.test(String(c[0])));
    expect(settled).toBe(false);
  });

  it('sends normally when the member has not been reminded recently', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'dispatch-3' }] });
    mockQuery.mockResolvedValueOnce(NO_COOLDOWN);
    mockNotifyMember.mockResolvedValueOnce({ channel: 'sms', status: 'sent' });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await sendOnce(baseInput);

    expect(result).toEqual({ sent: true, status: 'sent' });
    expect(mockNotifyMember).toHaveBeenCalledTimes(1);
  });

  it('allows the send when the cooldown lookup itself fails — it is politeness, not correctness', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'dispatch-4' }] });
    mockQuery.mockRejectedValueOnce(new Error('db blip'));
    mockNotifyMember.mockResolvedValueOnce({ channel: 'sms', status: 'sent' });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await sendOnce(baseInput);

    expect(result).toEqual({ sent: true, status: 'sent' });
    expect(mockNotifyMember).toHaveBeenCalledTimes(1);
  });
});
