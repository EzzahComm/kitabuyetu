/**
 * sms_birthday_reminders job (docs/chama-reminder/CHAMA_REMINDER_ARCHITECTURE_INTEGRATION.md
 * §6/Phase 1 — finishing the half-built birthday SMS feature), against real
 * Postgres.
 *
 * Proves the candidate query (opt-in gate + exact-today DOB match) and the
 * reminder_dispatch_log-backed dedup (sendOnce, one send per member per year)
 * actually hold, plus that a member in two opted-in groups gets two
 * separately-billed messages — one per membership, matching how
 * loan/contribution reminders already behave.
 */
import { handleJob } from '@/lib/jobs/handlers';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';
import type { Job } from '@/lib/jobs/types';

const mockSendSingleSms = jest.fn();

jest.mock('@/lib/services/textsms.service', () => ({
  sendSingleSms: (...args: unknown[]) => mockSendSingleSms(...args),
  sendBulkSms: jest.fn(),
  sendBulkSmsChunked: jest.fn(),
  getDeliveryReport: jest.fn(),
  getProviderBalance: jest.fn(),
}));

// reminder_dispatch_log.job_execution_id has a real FK into job_queue, so a
// synthetic id (unlike sms_allowance_monthly_reset's, which writes no such
// row) needs a real job_queue row behind it.
async function makeBirthdayJob(): Promise<Job> {
  const [row] = await rawQuery<{ id: string }>(
    `INSERT INTO job_queue (type, payload, status) VALUES ('sms_birthday_reminders', '{}', 'processing') RETURNING id`,
  );
  return {
    id: row.id, type: 'sms_birthday_reminders', payload: {}, status: 'processing',
    attempts: 0, max_attempts: 5,
  } as unknown as Job;
}

function acceptedSms() {
  return { success: true, messageId: 'msg-1', networkId: '1', responseCode: 200, responseDescription: 'Success' };
}

async function provisionBilling(groupId: string, credits: number): Promise<void> {
  await rawQuery(
    `INSERT INTO billing_accounts (group_id, sms_credits)
     VALUES ($1, $2)
     ON CONFLICT (group_id) DO UPDATE SET sms_credits = EXCLUDED.sms_credits`,
    [groupId, credits],
  );
  // register_group() already creates an active subscription with a real
  // starter-plan bundled allowance (sms_allowance_included=50) — UPDATE it
  // rather than an INSERT ON CONFLICT DO NOTHING, which would silently keep
  // that allowance and have every reservation draw from it first (Phase 2b's
  // allowance-before-paid-credits order), leaving sms_credits (and this
  // helper's whole point) untouched.
  await rawQuery(
    `UPDATE subscriptions
     SET sms_rate = 0.90, sms_allowance_included = 0
     WHERE group_id = $1 AND status = 'active'`,
    [groupId],
  );
}

// register_group() leaves a fresh group at status='pending_verification' —
// the candidate query (like every other reminder scanner) only considers
// g.status='active', so tests need this to make the group eligible at all.
async function activateGroup(groupId: string): Promise<void> {
  await rawQuery(`UPDATE groups SET status = 'active' WHERE id = $1`, [groupId]);
}

async function optInBirthday(groupId: string): Promise<void> {
  await rawQuery(
    `INSERT INTO sms_group_settings (group_id, auto_send_birthday)
     VALUES ($1, true)
     ON CONFLICT (group_id) DO UPDATE SET auto_send_birthday = true`,
    [groupId],
  );
}

async function setBirthdayToday(memberId: string): Promise<void> {
  await rawQuery(
    `UPDATE members SET date_of_birth = (CURRENT_DATE - make_interval(years => 30))::date WHERE id = $1`,
    [memberId],
  );
}

async function smsCreditsOf(groupId: string): Promise<number> {
  const [row] = await rawQuery<{ sms_credits: string }>(
    `SELECT sms_credits FROM billing_accounts WHERE group_id = $1`, [groupId],
  );
  return Number(row.sms_credits);
}

describe('sms_birthday_reminders', () => {
  // Same reason as sms-bulk-personalization.test.ts's: resetDatabase() clears
  // job_queue only at the start of each test, so the last one's row would
  // outlive this file and land in job-stuck-sweep.test.ts's whole-table counts.
  //
  // TRUNCATE, not DELETE: reminder_dispatch_log.job_execution_id is ON DELETE
  // SET NULL, so deleting a job row here UPDATEs the dispatch-log rows this
  // suite just wrote — and migration 106's append-only trigger rejects any
  // update to a row that reached a terminal status ("is already terminal
  // (sent)"). TRUNCATE bypasses row triggers entirely, which is exactly why
  // scripts/clear-tenant-data.sql uses it too.
  afterAll(async () => {
    await rawQuery(`TRUNCATE TABLE public.job_queue CASCADE`);
  });

  beforeEach(() => {
    mockSendSingleSms.mockReset();
    mockSendSingleSms.mockResolvedValue(acceptedSms());
  });

  it('sends and bills a birthday SMS for an opted-in group with a matching DOB', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('treasurer');
    await activateGroup(groupId);
    await provisionBilling(groupId, 100);
    await optInBirthday(groupId);
    await setBirthdayToday(officerId);

    const result = await handleJob(await makeBirthdayJob());

    expect(result).toMatchObject({ sent: 1, skipped: 0, failed: 0 });
    expect(mockSendSingleSms).toHaveBeenCalledTimes(1);

    const currentYear = new Date().getUTCFullYear();
    // reference_id is the membership row (gm.id), not the bare member id —
    // see handleSmsBirthdayReminders's own comment on why. Join through
    // group_members to look the claim up the same way the handler wrote it.
    const [log] = await rawQuery<{ status: string }>(
      `SELECT rdl.status FROM reminder_dispatch_log rdl
       JOIN group_members gm ON gm.id = rdl.reference_id
       WHERE rdl.reference_type = 'birthday' AND rdl.reminder_stage = $2
         AND gm.member_id = $1`,
      [officerId, `birthday:${currentYear}`],
    );
    expect(log?.status).toBe('sent');
    expect(await smsCreditsOf(groupId)).toBeLessThan(100); // real charge, not credits_deducted=0
  });

  it('does not select a member from a group that has not opted in', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('treasurer');
    await activateGroup(groupId);
    await provisionBilling(groupId, 100);
    // No optInBirthday call — no sms_group_settings row at all for this group.
    await setBirthdayToday(officerId);

    const result = await handleJob(await makeBirthdayJob());

    expect(result).toMatchObject({ sent: 0 });
    expect(mockSendSingleSms).not.toHaveBeenCalled();

    const [log] = await rawQuery<{ status: string }>(
      `SELECT status FROM reminder_dispatch_log WHERE reference_type = 'birthday' AND reference_id = $1`,
      [officerId],
    );
    expect(log).toBeUndefined();
  });

  it('does not select a member whose birthday is not today', async () => {
    await resetDatabase();
    const { groupId } = await createTestGroup('treasurer');
    await activateGroup(groupId);
    await provisionBilling(groupId, 100);
    await optInBirthday(groupId);
    // date_of_birth left at register_group's default (1970-01-01) — not today.

    const result = await handleJob(await makeBirthdayJob());

    expect(result).toMatchObject({ sent: 0 });
    expect(mockSendSingleSms).not.toHaveBeenCalled();
  });

  it('sends only once per member per year across repeated same-day runs, without double billing', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('treasurer');
    await activateGroup(groupId);
    await provisionBilling(groupId, 100);
    await optInBirthday(groupId);
    await setBirthdayToday(officerId);

    const job = await makeBirthdayJob();
    const first = await handleJob(job);
    expect(first).toMatchObject({ sent: 1 });
    const creditsAfterFirst = await smsCreditsOf(groupId);

    const second = await handleJob(job);
    expect(second).toMatchObject({ sent: 0, skipped: 1 });

    expect(mockSendSingleSms).toHaveBeenCalledTimes(1); // never dispatched twice
    expect(await smsCreditsOf(groupId)).toBe(creditsAfterFirst); // never billed twice
  });

  it('bills a member in two opted-in groups separately, one message per group', async () => {
    await resetDatabase();
    const { groupId: groupA, officerId } = await createTestGroup('treasurer');
    const { groupId: groupB } = await createTestGroup('treasurer');
    await activateGroup(groupA);
    await activateGroup(groupB);
    await provisionBilling(groupA, 100);
    await provisionBilling(groupB, 100);
    await optInBirthday(groupA);
    await optInBirthday(groupB);
    await setBirthdayToday(officerId);

    // Same member joins the second group too (register_group makes a fresh
    // member per call; link_member_to_group — migration 098's SECURITY DEFINER
    // wrapper, the same RPC membersService.create() uses — is the real path
    // for attaching an EXISTING member to another group, handling the
    // person/group_member_counters bookkeeping a raw group_members INSERT
    // would otherwise violate a NOT NULL constraint on).
    const [member] = await rawQuery<{ first_name: string; last_name: string }>(
      `SELECT first_name, last_name FROM members WHERE id = $1`, [officerId],
    );
    await rawQuery(
      `SELECT link_member_to_group($1, $2, 'member', $3, $4)`,
      [officerId, groupB, member.first_name, member.last_name],
    );

    const result = await handleJob(await makeBirthdayJob());

    expect(result).toMatchObject({ sent: 2 });
    expect(mockSendSingleSms).toHaveBeenCalledTimes(2);
    expect(await smsCreditsOf(groupA)).toBeLessThan(100);
    expect(await smsCreditsOf(groupB)).toBeLessThan(100);

    const currentYear = new Date().getUTCFullYear();
    const logs = await rawQuery<{ group_id: string; status: string }>(
      `SELECT group_id, status FROM reminder_dispatch_log
       WHERE reference_type = 'birthday' AND reminder_stage = $1
         AND group_id = ANY($2::uuid[])`,
      [`birthday:${currentYear}`, [groupA, groupB]],
    );
    // Keyed on the membership row (gm.id), not the bare member_id — reminder_
    // dispatch_log's UNIQUE constraint is (reference_type, reference_id,
    // reminder_stage) with no group_id in the key, so keying on member_id alone
    // would have the second group's claim collide with the first (already
    // 'sent') and silently skip. Two distinct membership rows means two
    // distinct claims: one dispatch-log row per group, both 'sent'.
    expect(logs).toHaveLength(2);
    expect(logs.every((l) => l.status === 'sent')).toBe(true);
  });
});
