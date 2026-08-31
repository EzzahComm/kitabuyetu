/**
 * Per-group daily send cap (SMS-AUDIT-v3 G25 / INV-38, pathway T0-6).
 *
 * `sms_group_settings.daily_send_limit` has existed since migration 013 and
 * was returned to clients by /sms/settings, but no send path had ever read
 * it — six references in the codebase, all read-or-display. An operator could
 * see the field and reasonably believe a cap was in force when none was.
 *
 * Enforced in reserveCredits, the chokepoint every billed send passes, so
 * automation paths are covered as well as the HTTP routes.
 */
import { reserveCredits } from '@/lib/services/messaging-billing';
import { pool } from '@/lib/db';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';

async function provisionBilling(groupId: string, credits: number): Promise<void> {
  await rawQuery(
    `INSERT INTO billing_accounts (group_id, sms_credits)
     VALUES ($1, $2)
     ON CONFLICT (group_id) DO UPDATE SET sms_credits = EXCLUDED.sms_credits`,
    [groupId, credits],
  );
  await rawQuery(
    `INSERT INTO subscriptions (group_id, plan_type, status, sms_rate, monthly_fee, sms_allowance_included)
     VALUES ($1, 'starter', 'active', 0.90, 0, 0)
     ON CONFLICT DO NOTHING`,
    [groupId],
  );
}

async function setLimit(groupId: string, limit: number | null): Promise<void> {
  await rawQuery(
    `INSERT INTO sms_group_settings (group_id, daily_send_limit)
     VALUES ($1, $2)
     ON CONFLICT (group_id) DO UPDATE SET daily_send_limit = EXCLUDED.daily_send_limit`,
    [groupId, limit],
  );
}

/** Insert `n` usage rows for today, as if the group had already sent them. */
async function seedSentToday(groupId: string, n: number, billingState = 'consumed'): Promise<void> {
  for (let i = 0; i < n; i++) {
    await rawQuery(
      `INSERT INTO sms_usage_logs
         (group_id, recipient_phone, message_text, credits_deducted, billing_state, status, provider, payer_type)
       VALUES ($1, $2, 'x', 1, $3, 'sent', 'textsms', 'group')`,
      [groupId, `25470000${String(1000 + i).slice(-4)}`, billingState],
    );
  }
}

describe('daily send limit (G25)', () => {
  it('is unlimited when no settings row exists — every group today', async () => {
    await resetDatabase();
    const { groupId } = await createTestGroup('treasurer');
    await provisionBilling(groupId, 500);
    await seedSentToday(groupId, 50);

    const r = await reserveCredits(pool, { payerType: 'group', groupId }, 10);
    expect(r.ok).toBe(true);
  });

  it('is unlimited when the column is NULL', async () => {
    await resetDatabase();
    const { groupId } = await createTestGroup('treasurer');
    await provisionBilling(groupId, 500);
    await setLimit(groupId, null);
    await seedSentToday(groupId, 50);

    const r = await reserveCredits(pool, { payerType: 'group', groupId }, 10);
    expect(r.ok).toBe(true);
  });

  it('allows a send that lands exactly on the cap', async () => {
    await resetDatabase();
    const { groupId } = await createTestGroup('treasurer');
    await provisionBilling(groupId, 500);
    await setLimit(groupId, 10);
    await seedSentToday(groupId, 8);

    const r = await reserveCredits(pool, { payerType: 'group', groupId }, 2);
    expect(r.ok).toBe(true);
  });

  it('refuses the send that would exceed the cap, and charges nothing', async () => {
    await resetDatabase();
    const { groupId } = await createTestGroup('treasurer');
    await provisionBilling(groupId, 500);
    await setLimit(groupId, 10);
    await seedSentToday(groupId, 8);

    const r = await reserveCredits(pool, { payerType: 'group', groupId }, 3);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('daily_limit_reached');

    const [acct] = await rawQuery<{ reserved_sms_credits: string }>(
      `SELECT reserved_sms_credits FROM billing_accounts WHERE group_id=$1`, [groupId],
    );
    expect(Number(acct.reserved_sms_credits)).toBe(0);
  });

  it('does not count released rows — a refunded failure did not use the allowance', async () => {
    await resetDatabase();
    const { groupId } = await createTestGroup('treasurer');
    await provisionBilling(groupId, 500);
    await setLimit(groupId, 10);
    await seedSentToday(groupId, 9, 'released');

    // 9 released + 1 new = 1 against the cap, not 10.
    const r = await reserveCredits(pool, { payerType: 'group', groupId }, 1);
    expect(r.ok).toBe(true);
  });

  it('ignores rows from a previous day', async () => {
    await resetDatabase();
    const { groupId } = await createTestGroup('treasurer');
    await provisionBilling(groupId, 500);
    await setLimit(groupId, 5);
    await seedSentToday(groupId, 5);
    // Push them into yesterday, Kenyan time.
    await rawQuery(
      `UPDATE sms_usage_logs SET created_at = NOW() - INTERVAL '2 days' WHERE group_id=$1`,
      [groupId],
    );

    const r = await reserveCredits(pool, { payerType: 'group', groupId }, 5);
    expect(r.ok).toBe(true);
  });

  it('never caps platform/OTP sends', async () => {
    await resetDatabase();
    const { groupId } = await createTestGroup('treasurer');
    await provisionBilling(groupId, 500);
    await setLimit(groupId, 1);
    await seedSentToday(groupId, 50);

    const r = await reserveCredits(pool, { payerType: 'platform', groupId: null }, 1);
    expect(r.ok).toBe(true);
  });
});
