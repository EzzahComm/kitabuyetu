/**
 * Operator kill switch for SMS dispatch (SMS-AUDIT-v3 V3-05, pathway T0-5).
 *
 * There was no way to halt SMS during an incident short of a redeploy or
 * revoking the provider credential. The switch is a `feature_flags` row so it
 * can be flipped without a deploy, checked in reserveCredits — the one
 * chokepoint every billed send passes through, so automation paths are
 * covered as well as the HTTP routes.
 *
 * The two properties that matter beyond "it stops sends":
 *   - platform/OTP sends are EXEMPT, so a halt cannot lock users out of
 *     password reset;
 *   - a halt is TRANSIENT, so nothing it blocks may be recorded in a state
 *     that can never be retried once the halt lifts.
 */
import { reserveCredits, SMS_DISPATCH_FLAG } from '@/lib/services/messaging-billing';
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

async function setHalted(halted: boolean): Promise<void> {
  await rawQuery(
    `INSERT INTO feature_flags (key, name, description, enabled)
     VALUES ($1, 'SMS dispatch', 'Operator kill switch', $2)
     ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled`,
    [SMS_DISPATCH_FLAG, !halted],
  );
}

describe('SMS dispatch kill switch (V3-05)', () => {
  // feature_flags is a CONFIG table: resetDatabase() does not truncate it, so
  // a row written here outlives this suite and every later one in the same
  // --runInBand run. Leaving it disabled would halt SMS for every subsequent
  // suite; this is the same cross-suite config pollution that already makes
  // sms-analytics-margin fail in a full run. Remove the row either way.
  afterEach(async () => {
    await rawQuery(`DELETE FROM feature_flags WHERE key = $1`, [SMS_DISPATCH_FLAG]);
  });

  it('allows sends when no flag row exists at all', async () => {
    await resetDatabase();
    const { groupId } = await createTestGroup('treasurer');
    await provisionBilling(groupId, 100);

    // Deploying the switch must not change behaviour until an operator acts.
    const r = await reserveCredits(pool, { payerType: 'group', groupId }, 1);
    expect(r.ok).toBe(true);
  });

  it('allows sends when the flag is present and enabled', async () => {
    await resetDatabase();
    const { groupId } = await createTestGroup('treasurer');
    await provisionBilling(groupId, 100);
    await setHalted(false);

    const r = await reserveCredits(pool, { payerType: 'group', groupId }, 1);
    expect(r.ok).toBe(true);
  });

  it('refuses a group-funded reservation while halted, without touching the balance', async () => {
    await resetDatabase();
    const { groupId } = await createTestGroup('treasurer');
    await provisionBilling(groupId, 100);
    await setHalted(true);

    const r = await reserveCredits(pool, { payerType: 'group', groupId }, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('dispatch_halted');

    // Nothing was earmarked — a halted send must cost nothing.
    const [acct] = await rawQuery<{ sms_credits: string; reserved_sms_credits: string }>(
      `SELECT sms_credits, reserved_sms_credits FROM billing_accounts WHERE group_id=$1`,
      [groupId],
    );
    expect(Number(acct.sms_credits)).toBe(100);
    expect(Number(acct.reserved_sms_credits)).toBe(0);
  });

  it('still lets platform/OTP sends through while halted', async () => {
    await resetDatabase();
    const { groupId } = await createTestGroup('treasurer');
    await provisionBilling(groupId, 100);
    await setHalted(true);

    // The whole point: a halt must never lock users out of password reset.
    const r = await reserveCredits(pool, { payerType: 'platform', groupId: null }, 1);
    expect(r.ok).toBe(true);
  });

  it('resumes normally once the halt is lifted', async () => {
    await resetDatabase();
    const { groupId } = await createTestGroup('treasurer');
    await provisionBilling(groupId, 100);

    await setHalted(true);
    expect((await reserveCredits(pool, { payerType: 'group', groupId }, 1)).ok).toBe(false);

    await setHalted(false);
    expect((await reserveCredits(pool, { payerType: 'group', groupId }, 1)).ok).toBe(true);
  });
});
