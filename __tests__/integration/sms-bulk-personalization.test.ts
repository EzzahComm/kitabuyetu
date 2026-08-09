/**
 * Per-recipient template rendering in the bulk send path
 * (docs/chama-reminder/CHAMA_REMINDER_ARCHITECTURE_INTEGRATION.md §7/Phase 1,
 * third bullet), against real Postgres.
 *
 * Before this, sendBulkCampaign took ONE message string and handed the same
 * text to every recipient, so a campaign written with {{first_name}} delivered
 * that placeholder literally. The provider's bulk endpoint has always carried
 * an independent `message` per `mobile` (textsms.service.ts's BulkSmsItem) —
 * what was missing was the phone→member mapping to render against.
 *
 * Driven through handleJob('sms_bulk_send') rather than calling
 * sendBulkCampaign directly, because the wiring under test is precisely that
 * the job handler — the one point all four bulk paths funnel through —
 * resolves the vars at all. Asserts on the items handed to the provider AND
 * on sms_usage_logs.message_text, since the stored copy is the only record of
 * what a given number was actually sent.
 */
import { handleJob } from '@/lib/jobs/handlers';
import { membersService } from '@/lib/services/members.service';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';
import type { TenantContext } from '@/lib/db';
import type { Job } from '@/lib/jobs/types';
import type { BulkSmsItem, BulkSmsResult } from '@/lib/services/textsms.service';

const mockSendBulkSmsChunked = jest.fn<Promise<BulkSmsResult>, [BulkSmsItem[]]>();

jest.mock('@/lib/services/textsms.service', () => ({
  sendSingleSms: jest.fn(),
  sendBulkSms: jest.fn(),
  sendBulkSmsChunked: (...args: unknown[]) => mockSendBulkSmsChunked(args[0] as BulkSmsItem[]),
  getDeliveryReport: jest.fn(),
  getProviderBalance: jest.fn(),
}));

/** Accept every item the provider was handed, matched back by clientSmsId. */
function acceptAll(items: BulkSmsItem[]): BulkSmsResult {
  return {
    responses: items.map((item, i) => ({
      responseCode: 200, responseDescription: 'Success',
      mobile: item.mobile, messageId: `msg-${i + 1}`, networkId: '1',
      success: true, clientSmsId: item.clientSmsId as number,
    })),
    sent: items.length,
    failed: 0,
  };
}

async function provisionBilling(groupId: string): Promise<void> {
  await rawQuery(
    `INSERT INTO billing_accounts (group_id, sms_credits)
     VALUES ($1, 500)
     ON CONFLICT (group_id) DO UPDATE SET sms_credits = 500`,
    [groupId],
  );
  // register_group() already created an active subscription — UPDATE it rather
  // than INSERT ... ON CONFLICT DO NOTHING, which would leave the starter
  // plan's bundled allowance in place and change which pool is drawn from.
  await rawQuery(
    `UPDATE subscriptions SET sms_rate = 0.90, sms_allowance_included = 0
     WHERE group_id = $1 AND status = 'active'`,
    [groupId],
  );
}

/** A named member with a known phone, created through the real service so
 *  person/member_code bookkeeping matches production rows. */
async function addNamedMember(
  groupId: string, actorId: string, firstName: string, lastName: string, phone: string,
): Promise<void> {
  const ctx: TenantContext = { userId: actorId, groupId, role: 'chairperson' };
  await membersService.create(ctx, {
    phone, firstName, lastName, role: 'member',
  } as Parameters<typeof membersService.create>[1]);
}

async function makeBulkJob(payload: Record<string, unknown>): Promise<Job> {
  const [row] = await rawQuery<{ id: string }>(
    `INSERT INTO job_queue (type, payload, status)
     VALUES ('sms_bulk_send', $1::jsonb, 'processing') RETURNING id`,
    [JSON.stringify(payload)],
  );
  return {
    id: row.id, type: 'sms_bulk_send', payload, status: 'processing',
    attempts: 0, max_attempts: 3,
  } as unknown as Job;
}

async function sentTextByPhone(groupId: string): Promise<Map<string, string>> {
  const rows = await rawQuery<{ recipient_phone: string; message_text: string }>(
    `SELECT recipient_phone, message_text FROM sms_usage_logs WHERE group_id = $1`,
    [groupId],
  );
  return new Map(rows.map((r) => [r.recipient_phone, r.message_text]));
}

/** The items the provider was handed on the last dispatch, keyed by mobile. */
function dispatchedByPhone(): Map<string, string> {
  const items = mockSendBulkSmsChunked.mock.calls.at(-1)![0];
  return new Map(items.map((i) => [i.mobile, i.message]));
}

describe('bulk SMS per-recipient personalization', () => {
  // resetDatabase() clears job_queue, but only at the START of each test — the
  // final test's row would outlive this file. job-stuck-sweep.test.ts asserts
  // on resetStuckJobs()'s whole-table counts, so a leaked 'processing' row
  // joins its tally the moment it ages past the sweep threshold.
  // TRUNCATE rather than DELETE for the same reason sms-birthday-reminders.
  // test.ts documents: job_queue is referenced ON DELETE SET NULL by
  // reminder_dispatch_log, whose append-only trigger rejects updates to
  // terminal rows. TRUNCATE bypasses row triggers.
  afterAll(async () => {
    await rawQuery(`TRUNCATE TABLE public.job_queue CASCADE`);
  });

  beforeEach(() => {
    mockSendBulkSmsChunked.mockReset();
    mockSendBulkSmsChunked.mockImplementation((items) => Promise.resolve(acceptAll(items)));
  });

  it('renders each recipient their own name, and records what they were sent', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('chairperson');
    await provisionBilling(groupId);

    const amina = '254711000001';
    const brian = '254711000002';
    await addNamedMember(groupId, officerId, 'Amina', 'Hassan', amina);
    await addNamedMember(groupId, officerId, 'Brian', 'Otieno', brian);

    await handleJob(await makeBulkJob({
      groupId, sentBy: officerId,
      phones:  [amina, brian],
      message: 'Hi {{first_name}}, dues are due Friday.',
    }));

    const dispatched = dispatchedByPhone();
    expect(dispatched.get(amina)).toBe('Hi Amina, dues are due Friday.');
    expect(dispatched.get(brian)).toBe('Hi Brian, dues are due Friday.');

    // The stored copy must match the delivered copy, not the raw template —
    // sms_usage_logs is the only record of what each number received.
    const stored = await sentTextByPhone(groupId);
    expect(stored.get(amina)).toBe('Hi Amina, dues are due Friday.');
    expect(stored.get(brian)).toBe('Hi Brian, dues are due Friday.');
  });

  it('renders {{group_name}} on the immediate-campaign path, where nothing pre-rendered it', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('chairperson');
    await provisionBilling(groupId);

    const [group] = await rawQuery<{ name: string }>(`SELECT name FROM groups WHERE id=$1`, [groupId]);
    const phone = '254711000003';
    await addNamedMember(groupId, officerId, 'Amina', 'Hassan', phone);

    // /sms/campaign's immediate send enqueues input.message verbatim — unlike
    // the scheduler, it has never pre-rendered group-level vars, so this is
    // the handler resolving them on its own.
    await handleJob(await makeBulkJob({
      groupId, sentBy: officerId,
      phones:  [phone],
      message: '{{group_name}}: meeting moved to Saturday.',
    }));

    expect(dispatchedByPhone().get(phone)).toBe(`${group.name}: meeting moved to Saturday.`);
  });

  it('strips a placeholder it cannot resolve rather than delivering it literally', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('chairperson');
    await provisionBilling(groupId);

    // A custom_phones recipient: a real number with no member row behind it,
    // so {{first_name}} has nothing to resolve against.
    const stranger = '254711000004';

    await handleJob(await makeBulkJob({
      groupId, sentBy: officerId,
      phones:  [stranger],
      message: 'Reminder {{first_name}} the AGM is on Saturday.',
    }));

    const text = dispatchedByPhone().get(stranger)!;
    expect(text).not.toContain('{{');
    expect(text).toBe('Reminder the AGM is on Saturday.');
  });

  it('leaves a message with no placeholders byte-identical, including its own spacing', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('chairperson');
    await provisionBilling(groupId);

    const phone = '254711000005';
    await addNamedMember(groupId, officerId, 'Amina', 'Hassan', phone);

    // stripUnresolved() collapses runs of whitespace and trims — applying it
    // unconditionally would silently reflow an ordinary campaign body that has
    // nothing to render. personalize() short-circuits on messages with no
    // '{{' precisely so this stays untouched.
    const body = 'AGM Saturday 10am.\n\nVenue:  Community Hall\nPlease attend.';

    await handleJob(await makeBulkJob({
      groupId, sentBy: officerId, phones: [phone], message: body,
    }));

    expect(dispatchedByPhone().get(phone)).toBe(body);
    expect((await sentTextByPhone(groupId)).get(phone)).toBe(body);
  });
});
