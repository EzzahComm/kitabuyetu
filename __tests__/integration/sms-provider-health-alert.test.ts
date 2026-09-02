/**
 * sms_provider_health must raise EXACTLY ONE alert per incident, never one
 * per failed message, and never over SMS (SMS-AUDIT-v3 T3-4 closure test).
 *
 * The reference failure is real: on 2026-08-27 every welcome SMS to eight
 * Ndengelwa members failed with HTTP 401, each execution was written
 * permanently 'sent' on an append-only table, and it was found days later by
 * a human reading the database. Nothing was watching. These tests pin the
 * thing that watches now.
 */
import { sampleProviderHealth, readProviderHealth } from '@/lib/services/sms-health.service';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';

const mockQueueEmail = jest.fn().mockResolvedValue('job-id');

jest.mock('@/lib/services/email.service', () => ({
  queueEmail: (...args: unknown[]) => mockQueueEmail(...args),
  sendTemplatedEmail: jest.fn(),
}));

/**
 * Write `count` usage rows for one group, `failed` of them failed. Inserted
 * directly rather than driven through smsService.send(): this is a test about
 * how a WINDOW OF OUTCOMES is read, and going through the send path would
 * drag reservations and provider mocks into a question that has nothing to do
 * with either.
 */
async function seedUsage(groupId: string, count: number, failed: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await rawQuery(
      `INSERT INTO sms_usage_logs
         (group_id, recipient_phone, message_text, credits_deducted, status, provider, created_at)
       VALUES ($1, $2, 'health sample', 0, $3, 'textsms', NOW() - INTERVAL '5 minutes')`,
      [groupId, `25470000${String(1000 + i).slice(-4)}`, i < failed ? 'failed' : 'sent'],
    );
  }
}

describe('sms provider health alerting', () => {
  let groupId: string;

  beforeEach(async () => {
    await resetDatabase();
    ({ groupId } = await createTestGroup('chairperson'));
    mockQueueEmail.mockClear();
    process.env.EMAIL_ADMIN = 'ops@example.com';
    // sms_provider_health_state is PLATFORM state, not tenant data, so
    // resetDatabase() deliberately does not truncate it — its whole job is to
    // remember across runs that staff were already told. Reset it explicitly,
    // or last_alerted_at from one case silently suppresses the alert the next
    // case is asserting on.
    await rawQuery(
      `INSERT INTO sms_provider_health_state (provider, state)
       VALUES ('textsms','healthy')
       ON CONFLICT (provider) DO UPDATE
         SET state = 'healthy', last_alerted_at = NULL, last_checked_at = NULL,
             sample_total = NULL, sample_failed = NULL, updated_at = NOW()`,
    );
  });

  it('issues no verdict and no alert on a window too small to judge', async () => {
    await seedUsage(groupId, 4, 4); // 100% failed, but only 4 messages

    const s = await sampleProviderHealth();

    expect(s.state).toBeNull();
    expect(s.alerted).toBe(false);
    expect(mockQueueEmail).not.toHaveBeenCalled();
  });

  it('stays healthy on ordinary failure noise', async () => {
    await seedUsage(groupId, 20, 3); // 15% — invalid numbers, not an outage

    const s = await sampleProviderHealth();

    expect(s.state).toBe('healthy');
    expect(s.alerted).toBe(false);
    expect(mockQueueEmail).not.toHaveBeenCalled();
  });

  it('alerts ONCE on a total outage, not once per failed message', async () => {
    await seedUsage(groupId, 20, 20); // the 401-outage shape: everything failed

    const first = await sampleProviderHealth();
    expect(first.state).toBe('degraded');
    expect(first.alerted).toBe(true);
    expect(mockQueueEmail).toHaveBeenCalledTimes(1);

    // The outage continues and the job runs again an hour later. It must not
    // send a second time — this is the assertion the closure test names.
    const second = await sampleProviderHealth();
    expect(second.state).toBe('degraded');
    expect(second.alerted).toBe(false);
    expect(mockQueueEmail).toHaveBeenCalledTimes(1);
  });

  it('sends the alert by email only — never over SMS', async () => {
    await seedUsage(groupId, 20, 20);
    const before = await rawQuery<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM sms_usage_logs`,
    );

    await sampleProviderHealth();

    const [call] = mockQueueEmail.mock.calls;
    expect(call[0].to).toBe('ops@example.com');
    expect(call[0].templateKey).toBe('sms_provider_degraded');

    // Alerting about a broken SMS channel must not put anything down that
    // channel: no new usage row exists after the alert.
    const after = await rawQuery<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM sms_usage_logs`,
    );
    expect(after[0].n).toBe(before[0].n);
  });

  it('re-arms after recovery, so the NEXT incident alerts immediately', async () => {
    await seedUsage(groupId, 20, 20);
    await sampleProviderHealth();
    expect(mockQueueEmail).toHaveBeenCalledTimes(1);

    // Provider recovers: clear the window and seed a healthy one.
    await rawQuery(`DELETE FROM sms_usage_logs`);
    await seedUsage(groupId, 20, 0);
    const recovery = await sampleProviderHealth();
    expect(recovery.state).toBe('healthy');
    expect(recovery.recovered).toBe(true);

    // A second incident must alert again rather than sit out the 6-hour
    // cool-off left over from the first — the exact defect M1 found in the
    // low-balance alert, which stayed silent for 24h after a top-up.
    await rawQuery(`DELETE FROM sms_usage_logs`);
    await seedUsage(groupId, 20, 20);
    const second = await sampleProviderHealth();

    expect(second.state).toBe('degraded');
    expect(second.alerted).toBe(true);
    expect(mockQueueEmail).toHaveBeenCalledTimes(2);
  });

  it('persists the verdict for the status page to read without a provider call', async () => {
    await seedUsage(groupId, 20, 20);
    await sampleProviderHealth();

    const health = await readProviderHealth();
    expect(health?.state).toBe('degraded');
    expect(health?.checkedAt).toBeInstanceOf(Date);
  });

  it('does not alert when EMAIL_ADMIN is unset, and does not throw either', async () => {
    delete process.env.EMAIL_ADMIN;
    await seedUsage(groupId, 20, 20);

    const s = await sampleProviderHealth();

    expect(s.state).toBe('degraded');
    expect(mockQueueEmail).not.toHaveBeenCalled();
  });
});
