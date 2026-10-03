/**
 * notify_weekly_savings_update (handleWeeklySavingsUpdate in lib/jobs/handlers.ts),
 * against real Postgres.
 *
 * Unlike notify_contribution_reminders (contribution-statement.test.ts), this
 * job is NOT gated on a configured contribution_plan and does NOT exclude
 * members who are caught up — every active member of every active group gets
 * a message. Proves: every member is reached regardless of plan; outstanding
 * is computed against the effective weekly target (group override, else the
 * migration-207 platform default) since the later of the member's join date
 * and the group's own creation date; totals are correct; the same week never
 * sends or bills twice.
 */
import { handleJob } from '@/lib/jobs/handlers';
import { platformPaybill } from '@/lib/sms/templates';
import { addGroupOfficer, createTestGroup } from './helpers/fixtures';
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

async function makeJob(): Promise<Job> {
  const [row] = await rawQuery<{ id: string }>(
    `INSERT INTO job_queue (type, payload, status) VALUES ('notify_weekly_savings_update', '{}', 'processing') RETURNING id`,
  );
  return {
    id: row.id,
    type: 'notify_weekly_savings_update',
    payload: {},
    status: 'processing',
    attempts: 0,
    max_attempts: 5,
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
  await rawQuery(
    `UPDATE subscriptions SET sms_rate = 0.90, sms_allowance_included = 0 WHERE group_id = $1 AND status = 'active'`,
    [groupId],
  );
}

async function activateGroup(groupId: string): Promise<void> {
  await rawQuery(`UPDATE groups SET status = 'active' WHERE id = $1`, [groupId]);
}

/** Pins the group's own "onboarded to Kitabu Yetu" date for a deterministic arrears-start point. */
async function setGroupCreatedAt(groupId: string, weeksAgo: number): Promise<void> {
  await rawQuery(
    `UPDATE groups SET created_at = date_trunc('week', now()) - make_interval(weeks => $2::int) WHERE id = $1`,
    [groupId, weeksAgo],
  );
}

async function setJoined(groupId: string, weeksAgo: number, memberId?: string): Promise<void> {
  await rawQuery(
    `UPDATE group_members
        SET joined_at = (date_trunc('week', now()) - make_interval(weeks => $2::int))::date
      WHERE group_id = $1 AND ($3::uuid IS NULL OR member_id = $3::uuid)`,
    [groupId, weeksAgo, memberId ?? null],
  );
}

async function setGroupWeeklyOverride(groupId: string, amount: number): Promise<void> {
  await rawQuery(
    `INSERT INTO policies (domain, policy_key, group_id, value, version)
     VALUES ('weekly_contribution_default', 'amount', $1, $2::jsonb, 1)`,
    [groupId, JSON.stringify({ weeklyContribution: amount })],
  );
}

async function membershipOf(groupId: string, memberId: string): Promise<{ id: string; no: string }> {
  const [row] = await rawQuery<{ id: string; membership_no: string }>(
    `SELECT id, membership_no FROM group_members WHERE group_id = $1 AND member_id = $2`,
    [groupId, memberId],
  );
  return { id: row.id, no: row.membership_no };
}

async function phoneOf(memberId: string): Promise<string> {
  const [row] = await rawQuery<{ phone: string }>(`SELECT phone FROM members WHERE id = $1`, [memberId]);
  return row.phone;
}

/** A completed contribution of `amount` landing mid-week, `weeksAgo` weeks back. */
async function pay(groupId: string, memberId: string, amount: number, weeksAgo: number): Promise<void> {
  const { id } = await membershipOf(groupId, memberId);
  await rawQuery(
    `INSERT INTO contributions (group_id, member_id, group_membership_id, amount, status, contribution_date)
     VALUES ($1, $2, $3, $4, 'completed',
             (date_trunc('week', now()) - make_interval(weeks => $5::int) + interval '2 days')::date)`,
    [groupId, memberId, id, amount, weeksAgo],
  );
}

function statements(): { mobile: string; message: string }[] {
  return mockSendSingleSms.mock.calls
    .map((call) => call[0] as { mobile: string; message: string })
    .filter((sms) => sms.message.includes('weekly update'));
}

function statementFor(phone: string): string | undefined {
  return statements().find((sms) => sms.mobile === phone)?.message;
}

async function setupGroup(extra: number): Promise<{ groupId: string; officerId: string; memberIds: string[] }> {
  const { groupId, officerId } = await createTestGroup('treasurer');
  await activateGroup(groupId);
  await provisionBilling(groupId, 500);
  const memberIds: string[] = [];
  for (let i = 0; i < extra; i++) memberIds.push(await addGroupOfficer(groupId, officerId, 'member'));
  return { groupId, officerId, memberIds };
}

describe('notify_weekly_savings_update (weekly savings-update SMS)', () => {
  afterAll(async () => {
    await rawQuery(`TRUNCATE TABLE public.job_queue CASCADE`);
  });

  beforeEach(() => {
    mockSendSingleSms.mockReset();
    mockSendSingleSms.mockResolvedValue(acceptedSms());
  });

  it('texts every active member, not just those behind, against the platform default of KES 200/week', async () => {
    await resetDatabase();
    const { groupId, officerId, memberIds } = await setupGroup(1);
    const [other] = memberIds;
    await setGroupCreatedAt(groupId, 2); // onboarded 2 weeks ago -> 2 closed weeks count (400 expected)
    await setJoined(groupId, 2);

    // Officer is fully caught up; the other member has paid nothing.
    await pay(groupId, officerId, 200, 1);
    await pay(groupId, officerId, 200, 2);

    const result = await handleJob(await makeJob());

    expect(result).toMatchObject({ attempted: 2, sent: 2, failed: 0 });
    expect(statements()).toHaveLength(2);

    const officerMsg = statementFor(await phoneOf(officerId));
    expect(officerMsg).toContain('Your total contribution to date is KES 400.');
    expect(officerMsg).toMatch(/fully paid up/);
    expect(officerMsg).not.toMatch(/Paybill/);

    const otherMembership = await membershipOf(groupId, other);
    const otherMsg = statementFor(await phoneOf(other));
    expect(otherMsg).toContain('Your total contribution to date is KES 0.');
    expect(otherMsg).toContain('You have KES 400 outstanding.');
    expect(otherMsg).toContain(`Acc ${otherMembership.no}.`);
  });

  it("states the group's total saved across all members, not just the recipient's own", async () => {
    await resetDatabase();
    const { groupId, officerId, memberIds } = await setupGroup(1);
    const [other] = memberIds;
    await setGroupCreatedAt(groupId, 1);
    await setJoined(groupId, 1);

    await pay(groupId, officerId, 5000, 0);
    await pay(groupId, other, 3000, 0);

    await handleJob(await makeJob());

    const paybill = platformPaybill();
    const officerMsg = statementFor(await phoneOf(officerId));
    const otherMsg = statementFor(await phoneOf(other));
    expect(officerMsg).toContain('has saved KES 8,000 in total');
    expect(otherMsg).toContain('has saved KES 8,000 in total');
    // Both still see their OWN total contribution, not the group's.
    expect(officerMsg).toContain('Your total contribution to date is KES 5,000.');
    expect(otherMsg).toContain('Your total contribution to date is KES 3,000.');
    expect(officerMsg).toContain(paybill);
  });

  it("a group's own weekly override beats the platform default", async () => {
    await resetDatabase();
    const { groupId, officerId } = await setupGroup(0);
    await setGroupCreatedAt(groupId, 1);
    await setJoined(groupId, 1);
    await setGroupWeeklyOverride(groupId, 500); // this group expects 500/week, not the 200 default

    await handleJob(await makeJob());

    const msg = statementFor(await phoneOf(officerId));
    expect(msg).toContain('You have KES 500 outstanding.'); // 1 closed week x 500, nothing paid
  });

  it('arrears start from the later of the member joining and the group onboarding, never before either', async () => {
    await resetDatabase();
    const { groupId, officerId, memberIds } = await setupGroup(1);
    const [lateJoiner] = memberIds;
    await setGroupCreatedAt(groupId, 4); // group onboarded 4 weeks ago -> 4 closed weeks for long-standing members
    await setJoined(groupId, 4); // officer has been there since onboarding
    await setJoined(groupId, 1, lateJoiner); // this member joined only 1 week ago

    await handleJob(await makeJob());

    expect(statementFor(await phoneOf(officerId))).toContain('You have KES 800 outstanding.'); // 4 x 200
    expect(statementFor(await phoneOf(lateJoiner))).toContain('You have KES 200 outstanding.'); // 1 x 200
  });

  it('sends once per week: a second run skips everyone and never bills twice', async () => {
    await resetDatabase();
    const { groupId, officerId } = await setupGroup(0);
    await setGroupCreatedAt(groupId, 1);
    await setJoined(groupId, 1);

    const job = await makeJob();
    const first = await handleJob(job);
    expect(first).toMatchObject({ attempted: 1, sent: 1 });

    const second = await handleJob(job);
    expect(second).toMatchObject({ attempted: 1, sent: 0, skipped: 1 });
    expect(statementFor(await phoneOf(officerId))).toBeDefined();
    expect(statements()).toHaveLength(1); // never dispatched twice
  });
});
