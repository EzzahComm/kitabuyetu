/**
 * Backfill SMS credits for top-up payments that were paid but never credited.
 *
 * The bug (found 2026-08-12): processFulfillment() in
 * app/api/v1/mpesa/callback/route.ts gated the whole SMS-crediting block
 * behind `if (payment.invoice_id)`, but the billing page never sends an
 * invoiceId for a top-up and generateInvoice() has no callers — so
 * payment.invoice_id was always NULL and addSmsCredits() never ran. The user
 * was charged by Safaricom, shown a "Credits added" toast, and got nothing.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-uncredited-sms-topups.ts          # dry run
 *   npx tsx --env-file=.env.local scripts/backfill-uncredited-sms-topups.ts --apply  # write
 *
 * (tsx does not read .env.local on its own, and lib/env.ts hard-fails on any
 * missing key, so the --env-file flag is required rather than optional.)
 *
 * Idempotent and re-runnable: a payment is only credited when no sms_credits
 * ledger row already references it, which is the same row addSmsCredits()
 * writes. Running twice credits nothing the second time.
 *
 * This calls billingService.addSmsCredits() — the exact function the callback
 * should have called — rather than reimplementing the rate/credit maths, so a
 * backfilled row is indistinguishable from one credited normally.
 */
import { withAdminDb } from '../lib/db';
import { billingService } from '../lib/services/billing.service';

interface UncreditedTopup {
  payment_id: string;
  group_id: string;
  amount: string;
  mpesa_receipt_number: string | null;
  payment_date: string;
}

async function findUncredited(): Promise<UncreditedTopup[]> {
  return withAdminDb(async (db) => {
    const { rows } = await db.query<UncreditedTopup>(
      `SELECT p.id AS payment_id, p.group_id, p.amount,
              p.mpesa_receipt_number, p.payment_date
       FROM   payments p
       JOIN   mpesa_stk_requests s
              ON s.checkout_request_id = p.mpesa_checkout_request_id
       WHERE  s.purpose = 'sms_topup'
         AND  p.status  = 'completed'
         AND  NOT EXISTS (
                SELECT 1 FROM sms_credits sc WHERE sc.payment_id = p.id
              )
       ORDER BY p.payment_date`,
    );
    return rows;
  });
}

async function main() {
  const apply = process.argv.includes('--apply');

  const pending = await findUncredited();
  if (pending.length === 0) {
    console.log('No uncredited SMS top-ups found — nothing to do.');
    return;
  }

  console.log(`Found ${pending.length} paid-but-uncredited SMS top-up(s):`);
  for (const t of pending) {
    console.log(
      `  payment=${t.payment_id} group=${t.group_id} ` +
      `KES ${t.amount} receipt=${t.mpesa_receipt_number ?? '(none)'} paid=${t.payment_date}`,
    );
  }

  if (!apply) {
    console.log('\nDry run — re-run with --apply to credit these.');
    return;
  }

  for (const t of pending) {
    // Same ctx shape the callback route uses for this call.
    const ctx = { userId: 'system', groupId: t.group_id, role: 'chairperson' };
    await billingService.addSmsCredits(ctx, Number(t.amount), t.payment_id);
    console.log(`Credited KES ${t.amount} to group ${t.group_id} (payment ${t.payment_id})`);
  }

  const remaining = await findUncredited();
  console.log(
    `\nDone. ${pending.length} credited; ${remaining.length} still uncredited.`,
  );
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
