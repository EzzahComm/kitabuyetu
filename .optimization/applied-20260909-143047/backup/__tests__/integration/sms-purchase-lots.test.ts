/**
 * SMS purchase lots (migration 146) against real Postgres.
 *
 * Phase 4 of docs/audits/SMS_MONETIZATION_AUDIT_2026-08.md, implementing §4:
 * "DO NOT retroactively reprice previously purchased credits." A customer who
 * buys 5,000 at 0.90 and later 5,000 at 0.80 keeps the first batch at 0.90.
 *
 * The pooled balance stays authoritative for sends — lots are recorded
 * alongside it, the same way migration 141 introduced the ledger. So the
 * property under test is not "lots gate sending" (they must not) but "lots
 * tell the truth about which purchase the remaining credits came from".
 */
import { billingService } from '@/lib/services/billing.service';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';
import type { TenantContext } from '@/lib/db';

function ctxFor(groupId: string, userId: string): TenantContext {
  return { userId, groupId, role: 'chairperson' };
}

async function lots(groupId: string) {
  return rawQuery<{ credits_added: string; remaining_credits: string; rate_applied: string }>(
    `SELECT credits_added, remaining_credits, rate_applied
     FROM sms_credits WHERE group_id = $1 ORDER BY created_at, id`,
    [groupId],
  );
}

/** Add a purchase at an explicit rate and age, the way two top-ups apart in time look. */
async function purchase(
  groupId: string, credits: number, rate: number, daysAgo: number,
): Promise<void> {
  await rawQuery(
    `INSERT INTO sms_credits
       (group_id, billing_account_id, amount_paid, credits_added, remaining_credits,
        rate_applied, created_at)
     SELECT $1, ba.id, $2, $3, $3, $4, NOW() - ($5 || ' days')::interval
     FROM billing_accounts ba WHERE ba.group_id = $1`,
    [groupId, (credits * rate).toFixed(2), credits.toFixed(4), rate.toFixed(4), daysAgo],
  );
  await rawQuery(
    `UPDATE billing_accounts SET sms_credits = sms_credits + $1 WHERE group_id = $2`,
    [credits.toFixed(4), groupId],
  );
}

async function lotDrift(groupId: string): Promise<number> {
  const [row] = await rawQuery<{ lot_drift: string }>(
    `SELECT lot_drift FROM vw_sms_credit_reconciliation
     WHERE payer_type = 'group' AND payer_id = $1`,
    [groupId],
  );
  return Number(row.lot_drift);
}

describe('SMS purchase lots', () => {
  let groupId: string;
  let officerId: string;

  beforeEach(async () => {
    await resetDatabase();
    ({ groupId, officerId } = await createTestGroup('chairperson'));
    await rawQuery(`UPDATE billing_accounts SET sms_credits = 0 WHERE group_id = $1`, [groupId]);
  });

  it('never reprices a completed purchase — the §4 scenario', async () => {
    await purchase(groupId, 5000, 0.90, 2);
    await purchase(groupId, 5000, 0.80, 1);

    // Consume 6,000: FIFO empties the older 0.90 batch and takes 1,000 from the
    // newer one.
    await rawQuery(`SELECT draw_sms_credit_lots($1::uuid, 6000)`, [groupId]);
    await rawQuery(
      `UPDATE billing_accounts SET sms_credits = sms_credits - 6000 WHERE group_id = $1`,
      [groupId],
    );

    const rows = await lots(groupId);
    expect(Number(rows[0].remaining_credits)).toBe(0);
    expect(Number(rows[1].remaining_credits)).toBe(4000);

    // THE GUARANTEE: what each batch cost is untouched. Reaching a cheaper tier
    // later must not retroactively re-value what was already bought.
    expect(Number(rows[0].rate_applied)).toBeCloseTo(0.90, 4);
    expect(Number(rows[1].rate_applied)).toBeCloseTo(0.80, 4);

    expect(await lotDrift(groupId)).toBe(0);
  });

  it('draws oldest-first, not cheapest-first', async () => {
    // Ordering is by purchase time, never by price. LIFO or cheapest-first
    // would let a late purchase mask an older one — which matters the moment
    // an expiry policy exists, since the oldest credits are the ones that lapse.
    await purchase(groupId, 100, 0.90, 5);
    await purchase(groupId, 100, 0.50, 1); // newer AND cheaper

    await rawQuery(`SELECT draw_sms_credit_lots($1::uuid, 100)`, [groupId]);

    const rows = await lots(groupId);
    expect(Number(rows[0].remaining_credits)).toBe(0);   // the older one went
    expect(Number(rows[1].remaining_credits)).toBe(100); // the cheap one intact
  });

  it('cannot draw more than exists, so it can never fail a send', async () => {
    // draw_sms_credit_lots runs AFTER the provider accepted the message. If it
    // could throw, a delivered SMS would strand its reservation.
    await purchase(groupId, 50, 0.90, 1);

    const [row] = await rawQuery<{ draw_sms_credit_lots: string }>(
      `SELECT draw_sms_credit_lots($1::uuid, 99999)`, [groupId],
    );
    expect(Number(row.draw_sms_credit_lots)).toBe(50); // drew what existed

    const rows = await lots(groupId);
    expect(Number(rows[0].remaining_credits)).toBe(0);  // never negative
  });

  it('records a lot when a real top-up happens', async () => {
    await billingService.addSmsCredits(ctxFor(groupId, officerId), 90);

    const rows = await lots(groupId);
    expect(rows).toHaveLength(1);
    // A fresh purchase is entirely unspent.
    expect(Number(rows[0].remaining_credits)).toBe(Number(rows[0].credits_added));
    expect(await lotDrift(groupId)).toBe(0);
  });

  it('draws a lot down when messages are actually consumed', async () => {
    await billingService.addSmsCredits(ctxFor(groupId, officerId), 90);
    const before = Number((await lots(groupId))[0].remaining_credits);

    const [log] = await rawQuery<{ id: string }>(
      `INSERT INTO sms_usage_logs
         (group_id, recipient_phone, message_text, status, credits_deducted,
          payer_type, billing_state, credits_reserved, credits_from_allowance, reserved_at)
       VALUES ($1,'254700000055','t','queued',0,'group','reserved',3,0,NOW())
       RETURNING id`,
      [groupId],
    );
    await rawQuery(
      `UPDATE billing_accounts SET reserved_sms_credits = 3 WHERE group_id = $1`, [groupId],
    );
    await rawQuery(`SELECT settle_sms_credit_reservation($1::uuid[], 'consume')`, [[log.id]]);

    expect(Number((await lots(groupId))[0].remaining_credits)).toBe(before - 3);
    expect(await lotDrift(groupId)).toBe(0);
  });

  it('does not draw a lot for an allowance-funded message', async () => {
    // An allowance send consumes no PURCHASED credit, so no lot may move.
    await billingService.addSmsCredits(ctxFor(groupId, officerId), 90);
    const before = Number((await lots(groupId))[0].remaining_credits);

    const [log] = await rawQuery<{ id: string }>(
      `INSERT INTO sms_usage_logs
         (group_id, recipient_phone, message_text, status, credits_deducted,
          payer_type, billing_state, credits_reserved, credits_from_allowance, reserved_at)
       VALUES ($1,'254700000056','t','queued',0,'group','reserved',2,2,NOW())
       RETURNING id`,
      [groupId],
    );
    await rawQuery(`SELECT settle_sms_credit_reservation($1::uuid[], 'consume')`, [[log.id]]);

    expect(Number((await lots(groupId))[0].remaining_credits)).toBe(before);
  });

  it('surfaces credits that no purchase accounts for, rather than hiding them', async () => {
    // A manual grant straight onto billing_accounts has no lot behind it. That
    // is information, not corruption — lot_drift is where an operator sees it.
    await rawQuery(
      `UPDATE billing_accounts SET sms_credits = 40 WHERE group_id = $1`, [groupId],
    );
    expect(await lotDrift(groupId)).toBe(40);
  });

  it('has an updated_at column, without which any lot drawdown throws', async () => {
    // sms_credits carried a trg_sms_credits_updated_at trigger running
    // set_updated_at() while having no such column — invisible while the table
    // was insert-only, and an immediate failure the first time a row is
    // updated. Confirmed present in production before migration 146 added it.
    const [row] = await rawQuery<{ count: string }>(
      `SELECT count(*)::text AS count FROM information_schema.columns
       WHERE table_name = 'sms_credits' AND column_name = 'updated_at'`,
    );
    expect(Number(row.count)).toBe(1);
  });
});
