/**
 * Dismiss 7 unrouted M-Pesa rows that are pure C2B duplicate echoes of
 * payments that already completed successfully via STK.
 *
 * Root cause (found 2026-08-26): Safaricom — or this app's own webhook
 * setup — delivers BOTH the STK success callback AND a separate C2B-style
 * notification for the same underlying transaction. The STK callback
 * correctly matches by checkout_request_id and completes normally
 * (payment, subscription/contribution, confirmation SMS, all real). The C2B
 * handler receives the SAME receipt moments later, doesn't recognise
 * 'SUBSCRIPT'/'CONTRIB' (real references, just STK-only ones — see
 * PRODUCT_REFERENCE in plan-purchase.tsx and stk-prompt-dialog.tsx) as a
 * routable account reference, and files it to mpesa_unrouted — even though
 * there is nothing left to route, the money already landed correctly.
 *
 * Confirmed for all 7 by an EXACT mpesa_receipt_number match against an
 * already `status='completed', channel='stk'` payments row — not a guess.
 * Ndengelwa's (500, SUBSCRIPT) is confirmed premium; the other three
 * SUBSCRIPT rows (Khaka Womens Group, CAPITAL POINT CHAMA, Munyali Ukulima)
 * are confirmed starter — matching what the user stated independently.
 *
 *   npx tsx --env-file=.env.local scripts/dismiss-duplicate-unrouted-c2b-echoes.ts          # dry run
 *   npx tsx --env-file=.env.local scripts/dismiss-duplicate-unrouted-c2b-echoes.ts --apply  # write
 */
import { resolveUnroutedPayment } from '../lib/services/admin.service';
import { withAdminDb } from '../lib/db';

const ROWS = [
  { receipt: 'UHFQZ2SPYV', group: 'Khaka Womens Group',                 existingPayment: 'eb6e200e-7995-46db-ab03-cdcaa2fec379' },
  { receipt: 'UHJ1G3JL8E', group: 'CAPITAL POINT CHAMA',                existingPayment: '862c8a07-232a-45db-bd24-c903118db167' },
  { receipt: 'UHJ1G3JNUT', group: 'CAPITAL POINT CHAMA',                existingPayment: 'fa304a76-8b6f-492f-8d70-c5b46ecc827f' },
  { receipt: 'UHJQT3FU9M', group: 'CAPITAL POINT CHAMA',                existingPayment: '4aae224c-067f-40cd-9162-98f80bf85a6a' },
  { receipt: 'UHLJF3JS4M', group: 'Munyali Ukulima Self Help Group',    existingPayment: 'a727e8d9-8324-4915-af75-fe4436ed4fb5' },
  { receipt: 'UHLFR39EEB', group: 'Ndengelwa Community Water Project',  existingPayment: '5f896cef-e10e-4edf-93d8-ea17f0eaf5c6' },
  { receipt: 'UHLEH3J1KY', group: 'CAPITAL POINT CHAMA',                existingPayment: '0701ddd8-f286-4ebf-b0f5-d9bc412d895c' },
] as const;

async function main() {
  const apply = process.argv.includes('--apply');

  const { rows: unrouted } = await withAdminDb((db) =>
    db.query<{ id: string; receipt: string; resolved: boolean }>(
      `SELECT id, receipt, resolved FROM mpesa_unrouted WHERE receipt = ANY($1)`,
      [ROWS.map((r) => r.receipt)],
    ),
  );

  for (const target of ROWS) {
    const row = unrouted.find((u) => u.receipt === target.receipt);
    if (!row) { console.log(`SKIP ${target.receipt} — no unrouted row found (already resolved?)`); continue; }
    if (row.resolved) { console.log(`SKIP ${target.receipt} — already resolved`); continue; }

    console.log(`${apply ? 'DISMISSING' : '[DRY RUN] would dismiss'}: ${target.receipt} (${target.group}) — duplicate of payment ${target.existingPayment}`);
    if (!apply) continue;

    await resolveUnroutedPayment(row.id, 'dismiss', {
      adminId: 'script:dismiss-duplicate-unrouted-c2b-echoes',
      notes: `Duplicate C2B echo of an already-completed STK payment (${target.existingPayment}, group: ${target.group}). ` +
             `No money was ever unaccounted for — this row never represented anything to route.`,
    });
    console.log(`  done: ${target.receipt}`);
  }

  if (!apply) console.log('\nDry run only — rerun with --apply to write.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
