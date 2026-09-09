/**
 * SMS credit ledger (migration 141) against real Postgres.
 *
 * Phase 1 of docs/audits/SMS_MONETIZATION_AUDIT_2026-08.md. The ledger is
 * deliberately inert — nothing reads it to authorise a send — so its ONLY
 * value is that it agrees with the balance column it shadows. That makes
 * `drift = 0` the entire point of this file, and every other test here exists
 * to protect that one property.
 *
 * Real Postgres specifically: the invariant lives in a SECURITY DEFINER
 * function, an append-only trigger and a reconciliation view. A mocked
 * database reproduces none of them.
 */
import { billingService } from '@/lib/services/billing.service';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';
import type { TenantContext } from '@/lib/db';

function ctxFor(groupId: string, userId: string): TenantContext {
  return { userId, groupId, role: 'chairperson' };
}

async function drift(groupId: string): Promise<number> {
  const [row] = await rawQuery<{ drift: string }>(
    `SELECT drift FROM vw_sms_credit_reconciliation
     WHERE payer_type = 'group' AND payer_id = $1`,
    [groupId],
  );
  return Number(row.drift);
}

async function balance(groupId: string): Promise<number> {
  const [row] = await rawQuery<{ sms_credits: string }>(
    `SELECT sms_credits FROM billing_accounts WHERE group_id = $1`, [groupId],
  );
  return Number(row.sms_credits);
}

async function entries(groupId: string) {
  return rawQuery<{ entry_type: string; amount: string; allowance_amount: string }>(
    `SELECT entry_type::text, amount, allowance_amount
     FROM sms_credit_ledger WHERE group_id = $1 ORDER BY created_at`,
    [groupId],
  );
}

/** Put a reserved message in flight the way the real send path does. */
async function reserveOne(groupId: string, credits: number, fromAllowance = 0): Promise<string> {
  const [log] = await rawQuery<{ id: string }>(
    `INSERT INTO sms_usage_logs
       (group_id, recipient_phone, message_text, status, credits_deducted,
        payer_type, billing_state, credits_reserved, credits_from_allowance, reserved_at)
     VALUES ($1,'254700000099','test','queued',0,'group','reserved',$2,$3,NOW())
     RETURNING id`,
    [groupId, credits.toFixed(4), fromAllowance.toFixed(4)],
  );
  await rawQuery(
    `UPDATE billing_accounts
     SET reserved_sms_credits = reserved_sms_credits + $1 WHERE group_id = $2`,
    [(credits - fromAllowance).toFixed(4), groupId],
  );
  return log.id;
}

describe('SMS credit ledger', () => {
  let groupId: string;
  let officerId: string;

  beforeEach(async () => {
    await resetDatabase();
    ({ groupId, officerId } = await createTestGroup('chairperson'));
  });

  it('records a top-up and stays reconciled', async () => {
    await billingService.addSmsCredits(ctxFor(groupId, officerId), 90);

    const rows = await entries(groupId);
    expect(rows).toHaveLength(1);
    expect(rows[0].entry_type).toBe('purchase');
    expect(Number(rows[0].amount)).toBeGreaterThan(0);
    expect(await drift(groupId)).toBe(0);
  });

  it('records a consume and stays reconciled', async () => {
    await billingService.addSmsCredits(ctxFor(groupId, officerId), 90);
    const before = await balance(groupId);

    const logId = await reserveOne(groupId, 1.8);
    await rawQuery(`SELECT settle_sms_credit_reservation($1::uuid[], 'consume')`, [[logId]]);

    expect(await balance(groupId)).toBeCloseTo(before - 1.8, 4);

    const rows = await entries(groupId);
    expect(rows.map((r) => r.entry_type)).toEqual(['purchase', 'consume']);
    expect(Number(rows[1].amount)).toBeCloseTo(-1.8, 4);
    expect(await drift(groupId)).toBe(0);
  });

  it('writes NO entry for a release, because it moves no money', async () => {
    // The single easiest way to break this ledger is to record reservations.
    // Reserve and release shuffle money between sms_credits and
    // reserved_sms_credits on the same account and net to zero, so recording
    // either would make the ledger permanently disagree with the balance it
    // exists to verify.
    await billingService.addSmsCredits(ctxFor(groupId, officerId), 90);
    const before = await balance(groupId);

    const logId = await reserveOne(groupId, 0.9);
    await rawQuery(`SELECT settle_sms_credit_reservation($1::uuid[], 'release')`, [[logId]]);

    expect(await balance(groupId)).toBeCloseTo(before, 4);
    expect(await entries(groupId)).toHaveLength(1); // the purchase only
    expect(await drift(groupId)).toBe(0);
  });

  it('keeps allowance-covered sends out of the money column but records them', async () => {
    // An allowance send consumes a message and moves NO money. If its value
    // landed in `amount` the ledger would under-report the balance forever.
    await billingService.addSmsCredits(ctxFor(groupId, officerId), 90);
    const before = await balance(groupId);

    const logId = await reserveOne(groupId, 0.9, 0.9); // fully allowance-covered
    await rawQuery(`SELECT settle_sms_credit_reservation($1::uuid[], 'consume')`, [[logId]]);

    expect(await balance(groupId)).toBeCloseTo(before, 4);

    const rows = await entries(groupId);
    const consume = rows.find((r) => r.entry_type === 'consume');
    expect(consume).toBeDefined();
    expect(Number(consume!.amount)).toBe(0);              // no money moved
    expect(Number(consume!.allowance_amount)).toBeCloseTo(0.9, 4); // but it happened
    expect(await drift(groupId)).toBe(0);
  });

  it('is append-only', async () => {
    await billingService.addSmsCredits(ctxFor(groupId, officerId), 90);

    await expect(
      rawQuery(`UPDATE sms_credit_ledger SET amount = 999 WHERE group_id = $1`, [groupId]),
    ).rejects.toThrow(/append-only/);

    await expect(
      rawQuery(`DELETE FROM sms_credit_ledger WHERE group_id = $1`, [groupId]),
    ).rejects.toThrow(/append-only/);
  });

  it('does not double-record a replayed top-up callback', async () => {
    // addSmsCredits is exactly-once per payment_id (migration 137). The ledger
    // write sits AFTER that guard, so a replay that credits nothing must also
    // record nothing — otherwise the ledger claims a movement the balance
    // never made.
    const [payment] = await rawQuery<{ id: string }>(
      `INSERT INTO payments (group_id, amount, payment_method, status, payment_date)
       VALUES ($1, 90, 'mpesa', 'completed', CURRENT_DATE) RETURNING id`,
      [groupId],
    );

    await billingService.addSmsCredits(ctxFor(groupId, officerId), 90, payment.id);
    await billingService.addSmsCredits(ctxFor(groupId, officerId), 90, payment.id);

    expect(await entries(groupId)).toHaveLength(1);
    expect(await drift(groupId)).toBe(0);
  });

  it('seeds an opening balance so a pre-existing balance reconciles', async () => {
    // Migration 141 seeds one adjustment entry per non-zero account. Without
    // it the ledger could never reconcile against balances that predate it,
    // and the whole phase would prove nothing. Simulated here by crediting
    // outside the ledger, then re-seeding the way the migration does.
    await rawQuery(
      `UPDATE billing_accounts SET sms_credits = 55 WHERE group_id = $1`, [groupId],
    );
    expect(await drift(groupId)).toBe(55);

    await rawQuery(
      `INSERT INTO sms_credit_ledger (payer_type, group_id, entry_type, amount, balance_after, notes)
       SELECT 'group', group_id, 'adjustment', sms_credits, sms_credits, 'opening balance'
       FROM billing_accounts WHERE group_id = $1 AND sms_credits <> 0`,
      [groupId],
    );

    expect(await drift(groupId)).toBe(0);
  });

  it('records a system-driven top-up, where there is no human actor', async () => {
    // The M-Pesa callback runs with no interactive user and passes the
    // sentinel userId 'system'. Writing that straight into the ledger's
    // created_by uuid column throws `invalid input syntax for type uuid` and
    // takes the whole top-up transaction down with it — i.e. money received
    // and not credited, the exact failure mode migration 137 was written to
    // fix. Caught first by the existing top-up suite; pinned here at source.
    await billingService.addSmsCredits({ userId: 'system', groupId, role: 'chairperson' }, 90);

    const rows = await entries(groupId);
    expect(rows).toHaveLength(1);
    expect(rows[0].entry_type).toBe('purchase');
    expect(await drift(groupId)).toBe(0);

    const [row] = await rawQuery<{ created_by: string | null }>(
      `SELECT created_by FROM sms_credit_ledger WHERE group_id = $1`, [groupId],
    );
    expect(row.created_by).toBeNull();
  });

  it('has dropped the two dead money functions', async () => {
    const dead = await rawQuery<{ proname: string }>(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('deduct_sms_credits','debit_organization_sms_credits')`,
    );
    // Both were unreachable (no TS caller, no SQL caller) and deduct_sms_credits
    // additionally held EXECUTE for PUBLIC and authenticated on a money-mutating
    // function — the same PostgREST surface behind migrations 126 and 136.
    expect(dead).toHaveLength(0);
  });
});
