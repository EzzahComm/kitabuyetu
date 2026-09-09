/**
 * The stale-reservation sweeper (Phase 2a).
 *
 * notifyMember runs as a series of independent autocommit statements with no
 * enclosing transaction, so a process death between the provider call and the
 * settle write strands an earmark. A `finally` cannot cover that; this sweeper
 * is the backstop.
 *
 * The asymmetry below is the entire point and is the most expensive thing in
 * Phase 2a to get wrong: a naive "release everything stale" sweeper hands out
 * free SMS every time a settle write fails, because the provider already
 * charged us for anything it accepted.
 */
import { handleJob } from '@/lib/jobs/handlers';
import { rawQuery } from './helpers/db';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import type { Job } from '@/lib/jobs/types';

const SWEEP_JOB = {
  id: '00000000-0000-0000-0000-000000000001',
  type: 'sms_release_stale_reservations',
  payload: {},
  status: 'processing',
  attempts: 0,
  max_attempts: 5,
} as unknown as Job;

async function provision(groupId: string, credits: number): Promise<void> {
  await rawQuery(
    `INSERT INTO billing_accounts (group_id, sms_credits, reserved_sms_credits)
     VALUES ($1, $2, 0.90)
     ON CONFLICT (group_id) DO UPDATE
       SET sms_credits = EXCLUDED.sms_credits, reserved_sms_credits = 0.90`,
    [groupId, credits],
  );
}

/** A reservation aged past the sweeper's 15-minute threshold. */
async function staleLog(
  groupId: string,
  opts: { status: string; providerMsgId: string | null },
): Promise<string> {
  const [row] = await rawQuery<{ id: string }>(
    `INSERT INTO sms_usage_logs
       (group_id, recipient_phone, message_text, credits_deducted, credits_reserved,
        billing_state, reserved_at, status, provider_msg_id, payer_type)
     VALUES ($1,'254700000000','t',0,0.90,'reserved', NOW() - INTERVAL '30 minutes', $2, $3, 'group')
     RETURNING id`,
    [groupId, opts.status, opts.providerMsgId],
  );
  return row.id;
}

async function stateOf(id: string) {
  const [row] = await rawQuery<{ billing_state: string; credits_deducted: string }>(
    `SELECT billing_state, credits_deducted FROM sms_usage_logs WHERE id = $1`, [id],
  );
  return row;
}

async function creditsOf(groupId: string): Promise<number> {
  const [row] = await rawQuery<{ sms_credits: string }>(
    `SELECT sms_credits FROM billing_accounts WHERE group_id = $1`, [groupId],
  );
  return parseFloat(row.sms_credits);
}

describe('sms_release_stale_reservations', () => {
  let groupId: string;

  beforeAll(async () => {
    await resetDatabase();
    ({ groupId } = await createTestGroup('treasurer'));
  });

  beforeEach(async () => {
    await rawQuery(`DELETE FROM sms_usage_logs WHERE group_id = $1`, [groupId]);
    await provision(groupId, 100);
  });

  it('releases a reservation the provider never confirmed', async () => {
    const id = await staleLog(groupId, { status: 'queued', providerMsgId: null });

    await handleJob(SWEEP_JOB);

    expect((await stateOf(id)).billing_state).toBe('released');
    // Never dispatched, so it must cost nothing.
    expect(await creditsOf(groupId)).toBeCloseTo(100, 2);
  });

  it('consumes a reservation the provider accepted', async () => {
    const id = await staleLog(groupId, { status: 'sent', providerMsgId: '655405696' });

    await handleJob(SWEEP_JOB);

    const s = await stateOf(id);
    expect(s.billing_state).toBe('consumed');
    expect(parseFloat(s.credits_deducted)).toBeCloseTo(0.9, 2);
    // The provider already billed us for this one — releasing it would be
    // giving the SMS away.
    expect(await creditsOf(groupId)).toBeCloseTo(99.1, 2);
  });

  it('consumes on a provider message id even when the status write was lost', async () => {
    // The exact crash shape the sweeper exists for: the provider accepted and
    // returned an id, then the process died before the status update landed.
    const id = await staleLog(groupId, { status: 'queued', providerMsgId: '655405697' });

    await handleJob(SWEEP_JOB);

    expect((await stateOf(id)).billing_state).toBe('consumed');
    expect(await creditsOf(groupId)).toBeCloseTo(99.1, 2);
  });

  it('leaves reservations inside the threshold alone', async () => {
    const [row] = await rawQuery<{ id: string }>(
      `INSERT INTO sms_usage_logs
         (group_id, recipient_phone, message_text, credits_deducted, credits_reserved,
          billing_state, reserved_at, status, payer_type)
       VALUES ($1,'254700000000','t',0,0.90,'reserved', NOW(), 'queued', 'group')
       RETURNING id`,
      [groupId],
    );

    await handleJob(SWEEP_JOB);

    // Still in flight — settling it here would race the live send.
    expect((await stateOf(row.id)).billing_state).toBe('reserved');
  });
});
