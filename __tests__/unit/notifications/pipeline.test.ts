jest.mock('@/lib/db', () => ({ withAdminDb: jest.fn(), pool: { connect: jest.fn() } }));
jest.mock('@/lib/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('@/lib/jobs', () => ({ enqueueJob: jest.fn().mockResolvedValue('job-1') }));
jest.mock('@/lib/notifications/sms', () => ({ sendAdminSms: jest.fn() }));
jest.mock('@/lib/notifications/email', () => ({ sendAdminEmail: jest.fn() }));

import { withAdminDb } from '@/lib/db';
import { enqueueJob } from '@/lib/jobs';
import { sendAdminSms } from '@/lib/notifications/sms';
import { sendAdminEmail } from '@/lib/notifications/email';
import { emitActivity } from '@/lib/notifications/activity-notifier';
import { deliverNotification } from '@/lib/notifications/notification-queue';
import { runAdminDigest } from '@/lib/notifications/digest';
import { noteServerError, resetErrorWindow } from '@/lib/notifications/system-health';
import { ActivityEventType } from '@/lib/notifications/activity-events';
import { resetPreferenceCache } from '@/lib/notifications/preferences';

const mockQuery = jest.fn();
const ACTIVITY_ROW = {
  id: 'act-1',
  seq: '7',
  event_type: 'USER_REGISTERED',
  severity: 'INFO',
  title: 'New User Registration',
  description: null,
  actor_user_id: null,
  actor: { name: 'John Doe' },
  organization_id: null,
  organization_name: null,
  group_id: null,
  group_name: null,
  transaction_id: null,
  reference: null,
  amount: null,
  currency: null,
  status: null,
  metadata: {},
  occurred_at: '2026-09-29T11:35:00.000Z',
  created_at: '2026-09-29T11:35:00.000Z',
};

/** Route queries by SQL text so tests do not depend on call order. */
function useDb(handlers: {
  insertActivity?: () => unknown;
  deliveryClaim?: () => unknown;
  extra?: (sql: string) => unknown;
}) {
  let deliveryN = 0;
  mockQuery.mockImplementation(async (sql: string) => {
    if (/INSERT INTO platform_activity_logs/.test(sql))
      return { rows: handlers.insertActivity ? [handlers.insertActivity()].flat().filter(Boolean) : [ACTIVITY_ROW] };
    if (/INSERT INTO notification_deliveries/.test(sql)) return { rows: [{ id: `del-${++deliveryN}` }] };
    if (/UPDATE notification_deliveries[\s\S]*RETURNING id, seq/.test(sql))
      return { rows: handlers.deliveryClaim ? [handlers.deliveryClaim()].flat().filter(Boolean) : [] };
    if (/FROM platform_activity_logs WHERE id/.test(sql)) return { rows: [ACTIVITY_ROW] };
    if (/admin_notification_preferences/.test(sql)) return { rows: [] };
    const extra = handlers.extra?.(sql);
    return { rows: extra ? (Array.isArray(extra) ? extra : [extra]) : [] };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  resetPreferenceCache();
  resetErrorWindow();
  mockQuery.mockReset();
  (withAdminDb as jest.Mock).mockImplementation((fn) => fn({ query: mockQuery }));
  (sendAdminSms as jest.Mock).mockResolvedValue({ ok: true, provider: 'textsms', messageId: 'm1' });
  (sendAdminEmail as jest.Mock).mockResolvedValue({ ok: true, provider: 'resend', messageId: 'e1' });
  process.env.KITABU_ADMIN_ALERT_PHONE = '+254182625807';
  process.env.KITABU_ADMIN_ALERT_EMAIL = 'info@kitabuyetu.co.ke';
});

const insertCalls = () => mockQuery.mock.calls.filter(([sql]) => /INSERT INTO platform_activity_logs/.test(sql));
const deliveryCalls = () => mockQuery.mock.calls.filter(([sql]) => /INSERT INTO notification_deliveries/.test(sql));

describe('emitActivity', () => {
  it('registration: records the event and queues one SMS and one email to the official contacts', async () => {
    useDb({});
    const res = await emitActivity({
      type: ActivityEventType.USER_REGISTERED,
      dedupKey: 'register:u1',
      actor: { userId: 'u1', name: 'John Doe', email: 'john@example.com', phone: '254712345678' },
    });
    expect(res).toMatchObject({ recorded: true, duplicate: false, queued: 2 });
    expect(res.activityRef).toBe('ACT-20260929-000007');

    const deliveries = deliveryCalls();
    expect(deliveries).toHaveLength(2);
    const targets = deliveries.map(([, p]) => [p[1], p[2]]);
    expect(targets).toContainEqual(['sms', '254182625807']);
    expect(targets).toContainEqual(['email', 'info@kitabuyetu.co.ke']);
    // each delivery has a deterministic idempotency key: activity:channel:recipient
    expect(deliveries.map(([, p]) => p[3])).toEqual(['act-1:sms:254182625807', 'act-1:email:info@kitabuyetu.co.ke']);
    // backed by a retrying job per delivery
    expect(enqueueJob).toHaveBeenCalledTimes(2);
    expect(enqueueJob).toHaveBeenCalledWith(
      'admin_alert_deliver',
      { deliveryId: 'del-1' },
      expect.objectContaining({ dedup_key: 'admin_alert:del-1', max_attempts: 5 }),
    );
  });

  it('idempotency: the same event processed twice notifies once', async () => {
    useDb({ insertActivity: () => null }); // ON CONFLICT (dedup_key) DO NOTHING → no row
    const res = await emitActivity({ type: ActivityEventType.MPESA_STK_COMPLETED, dedupKey: 'stk:ABC' });
    expect(res).toMatchObject({ recorded: false, duplicate: true, queued: 0 });
    expect(deliveryCalls()).toHaveLength(0);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('flood protection: routine events are recorded but not alerted one by one', async () => {
    useDb({});
    const res = await emitActivity({
      type: ActivityEventType.CONTRIBUTION_RECEIVED,
      transaction: { amount: 500, reference: 'RCP1' },
    });
    expect(res.recorded).toBe(true);
    expect(res.queued).toBe(0);
    expect(deliveryCalls()).toHaveLength(0);
    expect(insertCalls()[0][1][20]).toBe(true); // aggregate flag → digest
  });

  it('an outsized routine transaction escalates to an individual HIGH alert', async () => {
    useDb({});
    const res = await emitActivity({
      type: ActivityEventType.CONTRIBUTION_RECEIVED,
      transaction: { amount: 250_000, reference: 'RCP2' },
    });
    expect(res.queued).toBe(2);
    expect(insertCalls()[0][1][1]).toBe('HIGH');
    expect(insertCalls()[0][1][20]).toBe(false);
  });

  it('withdrawal request: HIGH severity, SMS + email, delivered inline', async () => {
    useDb({
      deliveryClaim: () => ({
        id: 'del-1',
        seq: '1',
        activity_id: 'act-1',
        channel: 'sms',
        recipient: '254182625807',
        attempt_count: 1,
        created_at: '2026-09-29T11:35:00.000Z',
      }),
    });
    const res = await emitActivity({
      type: ActivityEventType.WITHDRAWAL_PENDING_REVIEW,
      dedupKey: 'withdrawal:w1:pending',
      transaction: { amount: 50_000, reference: 'WD-1' },
      adminPath: '/admin/campaigns',
    });
    expect(insertCalls()[0][1][1]).toBe('HIGH');
    // 1 SMS + emails to info@ (official), billing@ and admin@ (responsible departments)
    expect(res.queued).toBe(4);
    const targets = deliveryCalls().map(([, p]) => p[2]);
    expect(targets).toEqual(
      expect.arrayContaining([
        '254182625807',
        'info@kitabuyetu.co.ke',
        'billing@kitabuyetu.co.ke',
        'admin@kitabuyetu.co.ke',
      ]),
    );
    expect(sendAdminSms).toHaveBeenCalled();
  });

  it('never persists passwords, OTPs, tokens, API keys or PINs', async () => {
    useDb({});
    await emitActivity({
      type: ActivityEventType.SECURITY_ALERT,
      metadata: { password: 'p', otp: '1', accessToken: 't', api_key: 'k', mpesaPin: '1234', note: 'safe' },
      actor: { userId: 'u', name: 'X' },
    });
    const persisted = JSON.stringify(insertCalls()[0][1]);
    for (const secret of ['"p"', '"t"', '"k"', '1234']) expect(persisted).not.toContain(secret);
    expect(persisted).toContain('safe');
  });

  it('a database failure never throws into the business transaction', async () => {
    (withAdminDb as jest.Mock).mockRejectedValue(new Error('connection refused'));
    await expect(emitActivity({ type: ActivityEventType.USER_REGISTERED })).resolves.toMatchObject({ recorded: false });
  });

  it('a database outage still sends HIGH/CRITICAL alerts directly', async () => {
    (withAdminDb as jest.Mock).mockRejectedValue(new Error('connection refused'));
    await emitActivity({ type: ActivityEventType.DATABASE_FAILURE, description: 'db down' });
    expect(sendAdminSms).toHaveBeenCalledWith('254182625807', expect.stringContaining('Database Failure'));
    expect(sendAdminEmail).toHaveBeenCalled();
  });
});

describe('deliverNotification', () => {
  const claim =
    (attempt: number, channel = 'sms') =>
    () => ({
      id: 'del-1',
      seq: '1',
      activity_id: 'act-1',
      channel,
      recipient: channel === 'sms' ? '254182625807' : 'info@kitabuyetu.co.ke',
      attempt_count: attempt,
      created_at: '2026-09-29T11:35:00.000Z',
    });

  it('marks SENT with the provider message id on success', async () => {
    useDb({ deliveryClaim: claim(1) });
    await expect(deliverNotification('del-1')).resolves.toBe('sent');
    const upd = mockQuery.mock.calls.find(([sql]) => /SET status = 'SENT'/.test(sql));
    expect(upd?.[1]).toEqual(['del-1', 'textsms', 'm1']);
  });

  it('failure leaves the transaction alone: marks RETRYING and throws so the queue backs off', async () => {
    (sendAdminSms as jest.Mock).mockResolvedValue({ ok: false, provider: 'textsms', error: 'provider down' });
    useDb({ deliveryClaim: claim(1) });
    await expect(deliverNotification('del-1', { throwOnRetry: true })).rejects.toThrow('provider down');
    const upd = mockQuery.mock.calls.find(([sql]) => /SET status = \$2/.test(sql));
    expect(upd?.[1][1]).toBe('RETRYING');
  });

  it('after the last attempt: persists FAILED and records a delivery-failure event', async () => {
    (sendAdminSms as jest.Mock).mockResolvedValue({ ok: false, provider: 'textsms', error: 'still down' });
    useDb({ deliveryClaim: claim(5) });
    await expect(deliverNotification('del-1', { throwOnRetry: true })).resolves.toBe('failed_permanent');
    const upd = mockQuery.mock.calls.find(([sql]) => /SET status = \$2/.test(sql));
    expect(upd?.[1][1]).toBe('FAILED');
    expect(insertCalls().some(([, p]) => p[0] === ActivityEventType.NOTIFICATION_DELIVERY_FAILED)).toBe(true);
  });

  it('is a no-op when another worker already claimed or sent it', async () => {
    useDb({ deliveryClaim: () => null });
    await expect(deliverNotification('del-1')).resolves.toBe('skipped');
    expect(sendAdminSms).not.toHaveBeenCalled();
  });
});

describe('runAdminDigest', () => {
  it('rolls many routine events into one summary', async () => {
    const claimed = Array.from({ length: 100 }, (_, i) => ({
      id: `r${i}`,
      event_type: i < 98 ? 'CONTRIBUTION_RECEIVED' : 'TRANSACTION_FAILED',
      amount: '2854.00',
      organization_id: `org${i % 12}`,
      status: null,
      created_at: '2026-09-29T10:00:00.000Z',
    }));
    useDb({
      insertActivity: () => ({ ...ACTIVITY_ROW, id: 'digest-1', event_type: 'ACTIVITY_DIGEST' }),
      extra: (sql) => {
        if (/SELECT \(SELECT COUNT/.test(sql)) return [{ pending: '100', oldest: '2026-09-29T10:00:00Z', last: null }];
        if (/SET\s+digest_sent_at = NOW\(\)/.test(sql)) return claimed;
        return [];
      },
    });
    const res = await runAdminDigest();
    expect(res).toEqual({ sent: true, events: 100 });
    const digestInsert = insertCalls().find(([, p]) => p[0] === ActivityEventType.ACTIVITY_DIGEST);
    expect(digestInsert).toBeTruthy();
    const meta = JSON.parse(digestInsert![1][15]);
    expect(meta['Events summarised']).toBe(100);
    expect(meta['Organizations affected']).toBe(12);
    expect(meta.Failed).toBe(2);
    // one digest alert only - not 100
    expect(deliveryCalls().length).toBeLessThanOrEqual(2);
  });

  it('does nothing when nothing is pending', async () => {
    useDb({ extra: (sql) => (/SELECT \(SELECT COUNT/.test(sql) ? [{ pending: '0', oldest: null, last: null }] : []) });
    await expect(runAdminDigest()).resolves.toEqual({ sent: false, events: 0 });
  });
});

describe('server error spike detection', () => {
  it('raises one ERROR_SPIKE after a burst of errors, not one per error', async () => {
    useDb({});
    for (let i = 0; i < 24; i++) noteServerError();
    expect(insertCalls()).toHaveLength(0);
    noteServerError();
    await new Promise((r) => setTimeout(r, 20));
    expect(insertCalls().filter(([, p]) => p[0] === ActivityEventType.ERROR_SPIKE)).toHaveLength(1);
  });
});
