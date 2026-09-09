/**
 * sms_allowance_monthly_reset (Phase 2b migration 124; moved onto per-group
 * billing anniversaries by migration 151), against real Postgres.
 *
 * The contract CHANGED with 151 and these tests changed with it. It used to
 * be an unconditional sweep on the 1st of the month: run the job, every active
 * group's counter goes to zero. It is now "reset each group once per its own
 * billing cycle", which means:
 *
 *   - running it mid-cycle is a NO-OP, and must preserve usage. The job now
 *     runs DAILY, so this is the common case by a factor of thirty and a
 *     regression here would silently hand out a fresh allowance every night.
 *   - it is idempotent within a cycle, by comparing the anniversary derived
 *     from subscriptions.started_at against billing_accounts
 *     .sms_allowance_period_start.
 *
 * Unchanged: it must NOT touch sms_allowance_reserved. An in-flight
 * reservation self-drains through the normal settle flow (consume or
 * release); zeroing it here would mask a genuinely stuck reservation instead
 * of surfacing it to sms_release_stale_reservations, which exists to catch
 * exactly that.
 */
import { handleJob } from '@/lib/jobs/handlers';
import { rawQuery } from './helpers/db';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import type { Job } from '@/lib/jobs/types';

const RESET_JOB = {
  id: '00000000-0000-0000-0000-000000000002',
  type: 'sms_allowance_monthly_reset',
  payload: {},
  status: 'processing',
  attempts: 0,
  max_attempts: 5,
} as unknown as Job;

async function setAllowanceState(
  groupId: string, used: number, reserved: number,
): Promise<void> {
  await rawQuery(
    `UPDATE billing_accounts SET sms_allowance_used = $2, sms_allowance_reserved = $3
     WHERE group_id = $1`,
    [groupId, used, reserved],
  );
}

/**
 * Pretend a full billing cycle has elapsed, by pushing the recorded period
 * start back a month. Cheaper and far more legible than manipulating
 * started_at or the clock, and it exercises the real comparison the job makes.
 */
async function simulateCycleRollover(groupId: string): Promise<void> {
  await rawQuery(
    `UPDATE billing_accounts
     SET sms_allowance_period_start = COALESCE(sms_allowance_period_start, CURRENT_DATE)
                                      - INTERVAL '1 month'
     WHERE group_id = $1`,
    [groupId],
  );
}

/** Park the account firmly mid-cycle: period start is today's anniversary. */
async function markCycleCurrent(groupId: string): Promise<void> {
  await rawQuery(
    `UPDATE billing_accounts ba
     SET sms_allowance_period_start = (
           s.started_at::date
           + ((date_part('year',  age(CURRENT_DATE, s.started_at::date)) * 12
             + date_part('month', age(CURRENT_DATE, s.started_at::date)))::int)
             * INTERVAL '1 month')::date
     FROM subscriptions s
     WHERE s.group_id = ba.group_id AND ba.group_id = $1`,
    [groupId],
  );
}

async function allowanceStateOf(groupId: string) {
  const [row] = await rawQuery<{
    sms_allowance_used: number; sms_allowance_reserved: number;
    sms_allowance_period_start: Date | null;
  }>(
    `SELECT sms_allowance_used, sms_allowance_reserved, sms_allowance_period_start
     FROM billing_accounts WHERE group_id = $1`,
    [groupId],
  );
  return row;
}

describe('sms_allowance_monthly_reset', () => {
  let groupId: string;

  beforeAll(async () => {
    await resetDatabase();
    ({ groupId } = await createTestGroup('treasurer'));
  });

  it('zeroes sms_allowance_used once the billing cycle has rolled over', async () => {
    await setAllowanceState(groupId, 37, 0);
    await simulateCycleRollover(groupId);

    await handleJob(RESET_JOB);

    const s = await allowanceStateOf(groupId);
    expect(s.sms_allowance_used).toBe(0);
  });

  it('leaves usage alone mid-cycle — the job now runs every day', async () => {
    // The regression that matters most after migration 151. Before it, this
    // job ran monthly and reset unconditionally; running that behaviour daily
    // would give every group a fresh allowance every night.
    await markCycleCurrent(groupId);
    await setAllowanceState(groupId, 12, 0);

    await handleJob(RESET_JOB);

    const s = await allowanceStateOf(groupId);
    expect(s.sms_allowance_used).toBe(12);
  });

  it('is idempotent within a cycle — a second run changes nothing', async () => {
    await simulateCycleRollover(groupId);
    await setAllowanceState(groupId, 9, 0);

    await handleJob(RESET_JOB);
    const first = await allowanceStateOf(groupId);
    expect(first.sms_allowance_used).toBe(0);

    // Spend again inside the same cycle, then run once more.
    await setAllowanceState(groupId, 5, 0);
    await handleJob(RESET_JOB);

    const second = await allowanceStateOf(groupId);
    expect(second.sms_allowance_used).toBe(5); // not re-zeroed
  });

  it('advances the recorded period so the next cycle can be detected', async () => {
    await simulateCycleRollover(groupId);
    const before = await allowanceStateOf(groupId);

    await handleJob(RESET_JOB);

    const after = await allowanceStateOf(groupId);
    expect(after.sms_allowance_period_start).not.toBeNull();
    expect(new Date(after.sms_allowance_period_start!).getTime())
      .toBeGreaterThan(new Date(before.sms_allowance_period_start!).getTime());
  });

  it('leaves sms_allowance_reserved untouched — an in-flight reservation is not this job\'s job', async () => {
    await setAllowanceState(groupId, 10, 4);
    await simulateCycleRollover(groupId);

    await handleJob(RESET_JOB);

    const s = await allowanceStateOf(groupId);
    expect(s.sms_allowance_used).toBe(0);
    expect(s.sms_allowance_reserved).toBe(4); // untouched
  });

  it('does not touch a group whose subscription is cancelled', async () => {
    const { groupId: cancelled } = await createTestGroup('treasurer');
    await setAllowanceState(cancelled, 22, 0);
    await simulateCycleRollover(cancelled);
    await rawQuery(
      `UPDATE subscriptions SET status = 'cancelled' WHERE group_id = $1`,
      [cancelled],
    );

    await handleJob(RESET_JOB);

    const s = await allowanceStateOf(cancelled);
    expect(s.sms_allowance_used).toBe(22); // untouched — no active subscription
  });

  it('runs cleanly when nothing is due (idempotent, no error on an empty run)', async () => {
    await markCycleCurrent(groupId);
    await setAllowanceState(groupId, 0, 0);

    await expect(handleJob(RESET_JOB)).resolves.toBeDefined();

    const s = await allowanceStateOf(groupId);
    expect(s.sms_allowance_used).toBe(0);
  });
});
