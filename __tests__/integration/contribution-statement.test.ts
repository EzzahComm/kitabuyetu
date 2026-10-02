/**
 * notify_contribution_reminders — the monthly contribution/welfare statement
 * (handleContributionReminders in lib/jobs/handlers.ts), against real Postgres.
 *
 * Proves the arrears arithmetic and the guards around it actually hold: only
 * members who owe something are texted; what they owe is the shortfall against
 * their group's plan for each CLOSED month since the later of their join date and
 * the plan's start; a group with no plan is never touched; and the same month's
 * run never sends or bills twice.
 *
 * Months are always relative to "now" (`monthsAgo`), so the suite never goes stale.
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

// reminder_dispatch_log.job_execution_id has a real FK into job_queue, so the job
// needs a real row behind its id.
async function makeJob(): Promise<Job> {
  const [row] = await rawQuery<{ id: string }>(
    `INSERT INTO job_queue (type, payload, status) VALUES ('notify_contribution_reminders', '{}', 'processing') RETURNING id`,
  );
  return {
    id: row.id,
    type: 'notify_contribution_reminders',
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
  // Zero the bundled allowance so every reservation draws on the paid credits this
  // helper just set, rather than silently on the allowance (see the birthday suite).
  await rawQuery(
    `UPDATE subscriptions SET sms_rate = 0.90, sms_allowance_included = 0 WHERE group_id = $1 AND status = 'active'`,
    [groupId],
  );
}

// register_group() leaves a fresh group at 'pending_verification'; the scanner only
// considers active groups.
async function activateGroup(groupId: string): Promise<void> {
  await rawQuery(`UPDATE groups SET status = 'active' WHERE id = $1`, [groupId]);
}

/** Pins the active subscription's fee and start date for a deterministic group-balance expectation. */
async function setSubscriptionFee(groupId: string, monthlyFee: number, startedMonthsAgo: number): Promise<void> {
  await rawQuery(
    `UPDATE subscriptions
        SET monthly_fee = $2, started_at = date_trunc('month', now()) - make_interval(months => $3::int)
      WHERE group_id = $1 AND status = 'active'`,
    [groupId, monthlyFee, startedMonthsAgo],
  );
}

/** A plan whose first counted month is `startedMonthsAgo` months back (a whole month, so it counts in full). */
async function setPlan(
  groupId: string,
  plan: { monthlyContribution: number; welfareAmount: number },
  startedMonthsAgo: number,
): Promise<void> {
  await rawQuery(
    `INSERT INTO policies (domain, policy_key, group_id, value, version, effective_from)
     VALUES ('contribution_plan', 'amounts', $1, $2::jsonb, 1,
             date_trunc('month', now()) - make_interval(months => $3::int))`,
    [groupId, JSON.stringify(plan), startedMonthsAgo],
  );
}

/** Everyone in the group joined this many whole months ago (before the plan, unless told otherwise). */
async function setJoined(groupId: string, monthsAgo: number, memberId?: string): Promise<void> {
  await rawQuery(
    `UPDATE group_members
        SET joined_at = (date_trunc('month', now()) - make_interval(months => $2::int))::date
      WHERE group_id = $1 AND ($3::uuid IS NULL OR member_id = $3::uuid)`,
    [groupId, monthsAgo, memberId ?? null],
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

/** A completed contribution of `amount` landing mid-month, `monthsAgo` months back. */
async function pay(groupId: string, memberId: string, amount: number, monthsAgo: number): Promise<void> {
  const { id } = await membershipOf(groupId, memberId);
  await rawQuery(
    `INSERT INTO contributions (group_id, member_id, group_membership_id, amount, status, contribution_date)
     VALUES ($1, $2, $3, $4, 'completed',
             (date_trunc('month', now()) - make_interval(months => $5::int) + interval '9 days')::date)`,
    [groupId, memberId, id, amount, monthsAgo],
  );
}

/** A welfare pool payment attributed (by period_month/year) to the month `monthsAgo` months back. */
async function payWelfare(
  groupId: string,
  memberId: string,
  recordedBy: string,
  amount: number,
  monthsAgo: number,
): Promise<void> {
  const { id } = await membershipOf(groupId, memberId);
  // INSERT ... SELECT gives Postgres no column context to infer the parameter types
  // from (unlike VALUES), so each one is cast explicitly.
  await rawQuery(
    `WITH m AS (SELECT date_trunc('month', now()) - make_interval(months => $5::int) AS d)
     INSERT INTO welfare_pool_contributions
       (group_id, member_id, group_membership_id, amount, period_month, period_year, recorded_by)
     SELECT $1::uuid, $2::uuid, $3::uuid, $4::numeric,
            EXTRACT(MONTH FROM m.d)::smallint, EXTRACT(YEAR FROM m.d)::smallint, $6::uuid
       FROM m`,
    [groupId, memberId, id, amount, monthsAgo, recordedBy],
  );
}

/** Only the statements this job sent (a new member's welcome SMS is not one of them). */
function statements(): { mobile: string; message: string }[] {
  return mockSendSingleSms.mock.calls
    .map((call) => call[0] as { mobile: string; message: string })
    .filter((sms) => sms.message.includes('balance update'));
}

function statementFor(phone: string): string | undefined {
  return statements().find((sms) => sms.mobile === phone)?.message;
}

async function smsCreditsOf(groupId: string): Promise<number> {
  const [row] = await rawQuery<{ sms_credits: string }>(
    `SELECT sms_credits FROM billing_accounts WHERE group_id = $1`,
    [groupId],
  );
  return Number(row.sms_credits);
}

/** A group with an officer plus `extra` ordinary members, active and funded for SMS. */
async function setupGroup(extra: number): Promise<{ groupId: string; officerId: string; memberIds: string[] }> {
  const { groupId, officerId } = await createTestGroup('treasurer');
  await activateGroup(groupId);
  await provisionBilling(groupId, 500);
  const memberIds: string[] = [];
  for (let i = 0; i < extra; i++) memberIds.push(await addGroupOfficer(groupId, officerId, 'member'));
  return { groupId, officerId, memberIds };
}

describe('notify_contribution_reminders (monthly arrears statement)', () => {
  // TRUNCATE, not DELETE: reminder_dispatch_log.job_execution_id is ON DELETE SET
  // NULL, and migration 106's append-only trigger rejects any update to a row that
  // reached a terminal status. See sms-birthday-reminders.test.ts for the full story.
  afterAll(async () => {
    await rawQuery(`TRUNCATE TABLE public.job_queue CASCADE`);
  });

  beforeEach(() => {
    mockSendSingleSms.mockReset();
    mockSendSingleSms.mockResolvedValue(acceptedSms());
  });

  it('texts only the members who are behind, with what they owe and where to pay it', async () => {
    await resetDatabase();
    const { groupId, officerId, memberIds } = await setupGroup(2);
    const [behindNothingPaid, behindPartlyPaid] = memberIds;
    await setPlan(groupId, { monthlyContribution: 1000, welfareAmount: 0 }, 3); // months -3, -2, -1 count
    await setJoined(groupId, 6);

    // The officer is fully paid up for all three closed months.
    for (const monthsAgo of [1, 2, 3]) await pay(groupId, officerId, 1000, monthsAgo);
    // One member paid 600 last month and nothing before it: 400 + 1000 + 1000 short.
    await pay(groupId, behindPartlyPaid, 600, 1);

    const result = await handleJob(await makeJob());

    expect(result).toMatchObject({ attempted: 2, sent: 2, failed: 0 });
    expect(statements()).toHaveLength(2);
    expect(statementFor(await phoneOf(officerId))).toBeUndefined(); // paid up: not texted

    const paybill = platformPaybill();
    const none = await membershipOf(groupId, behindNothingPaid);
    const nothingPaid = statementFor(await phoneOf(behindNothingPaid));
    expect(nothingPaid).toContain('Contribution arrears KES 3,000 (3 mo, KES 0 paid to date).');
    expect(nothingPaid).toContain(`Paybill ${paybill}, Acc ${none.no}.`);
    expect(nothingPaid).not.toMatch(/welfare/i);

    const partly = await membershipOf(groupId, behindPartlyPaid);
    const partlyPaid = statementFor(await phoneOf(behindPartlyPaid));
    expect(partlyPaid).toContain('Contribution arrears KES 2,400 (3 mo, KES 600 paid to date).');
    expect(partlyPaid).toContain(`Acc ${partly.no}.`);
  });

  it('bills welfare against welfare payments and pays it to the -W account', async () => {
    await resetDatabase();
    const { groupId, officerId, memberIds } = await setupGroup(1);
    const [behind] = memberIds;
    await setPlan(groupId, { monthlyContribution: 0, welfareAmount: 200 }, 2); // months -2, -1 count
    await setJoined(groupId, 6);

    // The officer paid welfare for both closed months; the other member only for last month.
    await payWelfare(groupId, officerId, officerId, 200, 1);
    await payWelfare(groupId, officerId, officerId, 200, 2);
    await payWelfare(groupId, behind, officerId, 200, 1);

    const result = await handleJob(await makeJob());

    expect(result).toMatchObject({ attempted: 1, sent: 1 });
    const membership = await membershipOf(groupId, behind);
    const message = statementFor(await phoneOf(behind));
    expect(message).toContain('Welfare arrears KES 200 (1 mo, KES 200 paid to date).');
    expect(message).toContain(`Acc ${membership.no}-W.`);
    expect(message).not.toMatch(/contribution/i);
  });

  it('puts both obligations in one message and names which account pays which', async () => {
    await resetDatabase();
    const { groupId, memberIds } = await setupGroup(1);
    const [behind] = memberIds;
    await setPlan(groupId, { monthlyContribution: 500, welfareAmount: 100 }, 2);
    await setJoined(groupId, 6);

    await handleJob(await makeJob());

    const membership = await membershipOf(groupId, behind);
    const message = statementFor(await phoneOf(behind));
    expect(message).toContain('Contribution arrears KES 1,000 (2 mo, KES 0 paid to date).');
    expect(message).toContain('Welfare arrears KES 200 (2 mo, KES 0 paid to date).');
    expect(message).toContain(`Acc ${membership.no} (contribution) or ${membership.no}-W (welfare).`);
  });

  it('never texts a group that has not configured a plan', async () => {
    await resetDatabase();
    await setupGroup(2); // no policy row at all, and nobody has paid anything
    const result = await handleJob(await makeJob());

    expect(result).toMatchObject({ attempted: 0, sent: 0 });
    expect(statements()).toHaveLength(0);
  });

  it('does not bill months from before the plan existed', async () => {
    await resetDatabase();
    const { groupId } = await setupGroup(1);
    await setPlan(groupId, { monthlyContribution: 1000, welfareAmount: 0 }, 0); // starts this month: nothing is closed yet
    await setJoined(groupId, 6);

    const result = await handleJob(await makeJob());

    expect(result).toMatchObject({ attempted: 0, sent: 0 });
    expect(statements()).toHaveLength(0);
  });

  it('bills a member who joined after the plan began only from the month they joined', async () => {
    await resetDatabase();
    const { groupId, officerId, memberIds } = await setupGroup(1);
    const [lateJoiner] = memberIds;
    await setPlan(groupId, { monthlyContribution: 1000, welfareAmount: 0 }, 4); // months -4..-1 count
    await setJoined(groupId, 6); // everyone joined before the plan...
    await setJoined(groupId, 1, lateJoiner); // ...except this member, who joined last month

    await handleJob(await makeJob());

    expect(statementFor(await phoneOf(lateJoiner))).toContain(
      'Contribution arrears KES 1,000 (1 mo, KES 0 paid to date).',
    );
    expect(statementFor(await phoneOf(officerId))).toContain(
      'Contribution arrears KES 4,000 (4 mo, KES 0 paid to date).',
    );
  });

  it('paid-to-date is a lifetime total, not capped by the 24-month arrears window', async () => {
    await resetDatabase();
    const { groupId, memberIds } = await setupGroup(1);
    const [behind] = memberIds;
    await setPlan(groupId, { monthlyContribution: 1000, welfareAmount: 0 }, 2);
    await setJoined(groupId, 36); // joined 3 years ago, well before the 24-month arrears cap
    // Two real payments: one inside the arrears-scan window, one 30 months back —
    // outside it, so the windowed arrears arithmetic never sees it, but the
    // lifetime paid-to-date figure must still include it.
    await pay(groupId, behind, 600, 1);
    await pay(groupId, behind, 5000, 30);

    await handleJob(await makeJob());

    const message = statementFor(await phoneOf(behind));
    // Arrears still computed only over the 2 closed months the plan counts.
    expect(message).toContain('Contribution arrears KES 1,400 (2 mo, KES 5,600 paid to date).');
  });

  it('group balance is contributions + welfare in, minus SMS cost and subscription fees, group-wide', async () => {
    await resetDatabase();
    const { groupId, memberIds } = await setupGroup(1);
    const [behind] = memberIds;
    await setPlan(groupId, { monthlyContribution: 100, welfareAmount: 0 }, 1); // 1 closed month
    await setJoined(groupId, 6);
    await pay(groupId, behind, 60, 1); // owes 40 still — stays a candidate; counts toward group income too
    await setSubscriptionFee(groupId, 1000, 2); // started 2 whole months ago -> 3 months billed = 3000
    // One real SMS usage row: 10 credits deducted, none from the free
    // allowance -> 10 paid credits at the group's 0.90 sms_rate (set by
    // provisionBilling) = 9.
    await rawQuery(
      `INSERT INTO sms_usage_logs (group_id, recipient_phone, message_text, credits_deducted, credits_from_allowance, status)
       VALUES ($1, '254700000000', 'test', 10, 0, 'delivered')`,
      [groupId],
    );

    await handleJob(await makeJob());

    const message = statementFor(await phoneOf(behind));
    // 60 (contributions) + 0 (welfare) - 9 (10 paid credits x 0.90 sms_rate) - 3000 (subscription) = -2949.
    expect(message).toMatch(/Group balance KES -2,949\.$/);
  });

  it('sends once per month: a second run skips everyone and never bills twice', async () => {
    await resetDatabase();
    const { groupId } = await setupGroup(1);
    await setPlan(groupId, { monthlyContribution: 1000, welfareAmount: 0 }, 2);
    await setJoined(groupId, 6);

    const job = await makeJob();
    const first = await handleJob(job);
    expect(first).toMatchObject({ attempted: 2, sent: 2 });
    const creditsAfterFirst = await smsCreditsOf(groupId);
    const callsAfterFirst = statements().length;

    const second = await handleJob(job);
    expect(second).toMatchObject({ attempted: 2, sent: 0, skipped: 2 });
    expect(statements()).toHaveLength(callsAfterFirst); // never dispatched twice
    expect(await smsCreditsOf(groupId)).toBe(creditsAfterFirst); // never billed twice
  });
});
