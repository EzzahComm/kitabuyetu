/**
 * Staff alerting for background controls (SMS-REAUDIT-2026-09-02 F2).
 *
 * The finding this closes: sms_credit_reconciliation detected a real
 * campaign-counter drift, logged "DRIFT — investigate" on every run for six
 * days, and reached no human, because logger.error has no sink. The control
 * worked; nobody could hear it.
 *
 * The properties that decide whether an alert survives a human inbox — and so
 * the properties worth pinning — are that it does NOT fire once per run for an
 * unchanged problem, that it DOES fire immediately when the problem changes,
 * and that resolving re-arms it.
 */
import { raiseStaffAlert, clearStaffAlert } from '@/lib/services/staff-alerts';
import { rawQuery } from './helpers/db';

const mockQueueEmail = jest.fn().mockResolvedValue('job-id');

jest.mock('@/lib/services/email.service', () => ({
  queueEmail: (...args: unknown[]) => mockQueueEmail(...args),
  sendTemplatedEmail: jest.fn(),
}));

const KEY = 'test_condition';

describe('staff alert sink', () => {
  beforeEach(async () => {
    mockQueueEmail.mockClear();
    process.env.EMAIL_ADMIN = 'ops@example.com';
    // staff_alert_state is platform state, not tenant data, so resetDatabase()
    // does not clear it — and its whole job is remembering across runs.
    await rawQuery(`DELETE FROM staff_alert_state WHERE alert_key = $1`, [KEY]);
  });

  afterAll(async () => {
    await rawQuery(`DELETE FROM staff_alert_state WHERE alert_key = $1`, [KEY]);
  });

  const alert = (details: unknown) => raiseStaffAlert({
    key: KEY, subject: 'Something disagrees', body: 'Details below.', details,
  });

  it('emails on the first occurrence', async () => {
    await expect(alert({ drifted: 1 })).resolves.toBe(true);
    expect(mockQueueEmail).toHaveBeenCalledTimes(1);

    const [call] = mockQueueEmail.mock.calls;
    expect(call[0].to).toBe('ops@example.com');
    expect(call[0].templateKey).toBe('staff_operational_alert');
  });

  it('does NOT re-email the same unchanged problem — the six-days-of-noise case', async () => {
    await alert({ drifted: 1 });
    expect(mockQueueEmail).toHaveBeenCalledTimes(1);

    // The job runs again tomorrow, and the day after, finding the same thing.
    await expect(alert({ drifted: 1 })).resolves.toBe(false);
    await expect(alert({ drifted: 1 })).resolves.toBe(false);

    expect(mockQueueEmail).toHaveBeenCalledTimes(1);
  });

  it('emails immediately when the problem CHANGES, without waiting out the window', async () => {
    await alert({ drifted: 1 });
    expect(mockQueueEmail).toHaveBeenCalledTimes(1);

    // A second campaign starts disagreeing: a different problem, not a repeat.
    await expect(alert({ drifted: 2 })).resolves.toBe(true);
    expect(mockQueueEmail).toHaveBeenCalledTimes(2);
  });

  it('re-arms after the condition clears, so the NEXT incident alerts at once', async () => {
    await alert({ drifted: 1 });
    expect(mockQueueEmail).toHaveBeenCalledTimes(1);

    await clearStaffAlert(KEY);

    // Identical fingerprint to the first alert. Without the re-arm this would
    // be suppressed as a repeat — the exact defect M1 found in the low-balance
    // alert, which went silent for 24h after a top-up.
    await expect(alert({ drifted: 1 })).resolves.toBe(true);
    expect(mockQueueEmail).toHaveBeenCalledTimes(2);
  });

  it('records that it checked even when it does not alert', async () => {
    await clearStaffAlert(KEY);

    const [row] = await rawQuery<{ last_checked_at: Date | null; fingerprint: string | null }>(
      `SELECT last_checked_at, fingerprint FROM staff_alert_state WHERE alert_key = $1`, [KEY],
    );
    // "Healthy" and "nothing ever ran" must be distinguishable.
    expect(row.last_checked_at).toBeInstanceOf(Date);
    expect(row.fingerprint).toBeNull();
  });

  it('does not throw, and does not claim to have alerted, with no recipient configured', async () => {
    delete process.env.EMAIL_ADMIN;

    await expect(alert({ drifted: 1 })).resolves.toBe(false);
    expect(mockQueueEmail).not.toHaveBeenCalled();
  });

  it('only one of two concurrent runs may alert', async () => {
    // Both see the same problem at the same moment; the claim-by-UPDATE is
    // what stops two emails.
    const [a, b] = await Promise.all([alert({ drifted: 9 }), alert({ drifted: 9 })]);

    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(mockQueueEmail).toHaveBeenCalledTimes(1);
  });
});
