/**
 * Top-up leaves no reconciliation drift (SMS-AUDIT-v3 G18 / INV-09,
 * pathway T1-5).
 *
 * sms_credit_ledger.amount is numeric(14,4) while billing_accounts.sms_credits
 * and sms_credits.credits_added are numeric(15,2). addSmsCredits passed an
 * unrounded amountKes/rate to all three, so the balance moved by the
 * column-rounded value while the ledger recorded the exact one — same-sign
 * drift on every purchase, and a ledger entry that disagreed with its own
 * balance_after.
 *
 * It has to be right BEFORE reconciliation alerting exists (T1-6), or the
 * first real top-up trips the alarm. Production drift is 0 today only because
 * no purchase has run since the ledger shipped.
 */
import { billingService } from '@/lib/services/billing.service';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';

async function provisionAccount(groupId: string): Promise<void> {
  await rawQuery(
    `INSERT INTO billing_accounts (group_id, sms_credits)
     VALUES ($1, 0)
     ON CONFLICT (group_id) DO UPDATE SET sms_credits = 0`,
    [groupId],
  );
  await rawQuery(
    `INSERT INTO subscriptions (group_id, plan_type, status, sms_rate, monthly_fee, sms_allowance_included)
     VALUES ($1, 'starter', 'active', 0.90, 0, 0)
     ON CONFLICT DO NOTHING`,
    [groupId],
  );
}

describe('top-up leaves no ledger drift (G18)', () => {
  it('records the movement the balance actually made', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('treasurer');
    await provisionAccount(groupId);

    // KES 100 at 0.90 is 111.111... — the non-terminating case that produced
    // the drift.
    await billingService.addSmsCredits(
      { userId: officerId, groupId, role: 'treasurer' },
      100,
    );

    const [row] = await rawQuery<{ balance: string; ledger: string }>(
      `SELECT ba.sms_credits AS balance,
              COALESCE((SELECT SUM(amount) FROM sms_credit_ledger
                         WHERE group_id = ba.group_id), 0) AS ledger
         FROM billing_accounts ba WHERE ba.group_id = $1`,
      [groupId],
    );

    expect(Number(row.balance)).toBe(Number(row.ledger));
  });

  it('reports exactly zero drift through the reconciliation view', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('treasurer');
    await provisionAccount(groupId);

    // Several purchases, so any per-purchase drift would accumulate visibly.
    for (const amount of [100, 250, 75]) {
      await billingService.addSmsCredits(
        { userId: officerId, groupId, role: 'treasurer' },
        amount,
      );
    }

    const [v] = await rawQuery<{ drift: string; lot_drift: string }>(
      `SELECT drift, lot_drift FROM vw_sms_credit_reconciliation
        WHERE payer_type = 'group' AND payer_id = $1`,
      [groupId],
    );

    expect(Number(v.drift)).toBe(0);
    expect(Number(v.lot_drift)).toBe(0);
  });
});
