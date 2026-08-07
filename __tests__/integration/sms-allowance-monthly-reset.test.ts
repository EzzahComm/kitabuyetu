/**
 * sms_allowance_monthly_reset (Phase 2b, migration 124), against real
 * Postgres.
 *
 * Zeroes sms_allowance_used for every group with an active subscription —
 * and must NOT touch sms_allowance_reserved. An in-flight reservation
 * self-drains through the normal settle flow (consume or release); zeroing
 * it here would mask a genuinely stuck reservation instead of surfacing it
 * to sms_release_stale_reservations, which exists precisely to catch that.
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

async function allowanceStateOf(groupId: string) {
  const [row] = await rawQuery<{ sms_allowance_used: number; sms_allowance_reserved: number }>(
    `SELECT sms_allowance_used, sms_allowance_reserved FROM billing_accounts WHERE group_id = $1`,
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

  it('zeroes sms_allowance_used for a group with an active subscription', async () => {
    await setAllowanceState(groupId, 37, 0);

    await handleJob(RESET_JOB);

    const s = await allowanceStateOf(groupId);
    expect(s.sms_allowance_used).toBe(0);
  });

  it('leaves sms_allowance_reserved untouched — an in-flight reservation is not this job\'s job', async () => {
    await setAllowanceState(groupId, 10, 4);

    await handleJob(RESET_JOB);

    const s = await allowanceStateOf(groupId);
    expect(s.sms_allowance_used).toBe(0);
    expect(s.sms_allowance_reserved).toBe(4); // untouched
  });

  it('does not touch a group whose subscription is cancelled', async () => {
    const { groupId: cancelled } = await createTestGroup('treasurer');
    await setAllowanceState(cancelled, 22, 0);
    await rawQuery(
      `UPDATE subscriptions SET status = 'cancelled' WHERE group_id = $1`,
      [cancelled],
    );

    await handleJob(RESET_JOB);

    const s = await allowanceStateOf(cancelled);
    expect(s.sms_allowance_used).toBe(22); // untouched — no active subscription
  });

  it('is a no-op for a group already at zero (idempotent, no error on an empty run)', async () => {
    await setAllowanceState(groupId, 0, 0);

    await expect(handleJob(RESET_JOB)).resolves.toBeDefined();

    const s = await allowanceStateOf(groupId);
    expect(s.sms_allowance_used).toBe(0);
  });
});
