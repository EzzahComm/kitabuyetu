/**
 * DR runbook — rebuild the payment_accounts routing registry.
 *
 *   npx tsx scripts/rebuild-payment-accounts.ts          # dry run (report only)
 *   npx tsx scripts/rebuild-payment-accounts.ts --commit # insert missing rows
 *
 * The registry is derived state (payment architecture §1.8): every row is
 * reconstructable from group_members (membership numbers + legacy member
 * codes) and invoices (invoice numbers). This script re-derives it
 * idempotently — existing rows are never touched (`ON CONFLICT DO NOTHING`),
 * so it is safe to run against a live system at any time.
 *
 * Use cases: disaster recovery after a partial restore, post-migration
 * verification (dry-run count must be zero on a healthy system), and the
 * production-readiness DR drill (checklist item 16).
 */
import { withAdminDb } from '../lib/db';

interface RebuildCounts {
  membershipNos: number;
  legacyCodes:   number;
  invoices:      number;
}

async function countMissing(): Promise<RebuildCounts> {
  return withAdminDb(async (db) => {
    const q = async (sql: string) =>
      parseInt((await db.query<{ n: string }>(sql)).rows[0].n, 10);

    return {
      membershipNos: await q(
        `SELECT COUNT(*) AS n FROM group_members gm
         WHERE NOT EXISTS (SELECT 1 FROM payment_accounts pa WHERE pa.identifier = gm.membership_no)`,
      ),
      legacyCodes: await q(
        `SELECT COUNT(*) AS n FROM group_members gm
         WHERE NOT EXISTS (SELECT 1 FROM payment_accounts pa WHERE pa.identifier = gm.member_code)`,
      ),
      invoices: await q(
        `SELECT COUNT(*) AS n FROM invoices i
         WHERE NOT EXISTS (SELECT 1 FROM payment_accounts pa WHERE pa.identifier = upper(i.invoice_number))`,
      ),
    };
  });
}

async function rebuild(): Promise<RebuildCounts> {
  return withAdminDb(async (db) => {
    const m = await db.query(
      `INSERT INTO payment_accounts (identifier, kind, membership_id)
       SELECT membership_no, 'membership_no', id FROM group_members
       ON CONFLICT (identifier) DO NOTHING`,
    );
    const l = await db.query(
      `INSERT INTO payment_accounts (identifier, kind, membership_id)
       SELECT member_code, 'legacy_code', id FROM group_members
       ON CONFLICT (identifier) DO NOTHING`,
    );
    const i = await db.query(
      `INSERT INTO payment_accounts (identifier, kind, invoice_id)
       SELECT upper(invoice_number), 'invoice', id FROM invoices
       ON CONFLICT (identifier) DO NOTHING`,
    );
    return {
      membershipNos: m.rowCount ?? 0,
      legacyCodes:   l.rowCount ?? 0,
      invoices:      i.rowCount ?? 0,
    };
  });
}

async function main(): Promise<void> {
  const commit = process.argv.includes('--commit');

  const missing = await countMissing();
  const total = missing.membershipNos + missing.legacyCodes + missing.invoices;
  console.log('payment_accounts — missing registry rows:');
  console.log(`  membership numbers : ${missing.membershipNos}`);
  console.log(`  legacy member codes: ${missing.legacyCodes}`);
  console.log(`  invoice numbers    : ${missing.invoices}`);

  if (total === 0) {
    console.log('Registry is complete. Nothing to do.');
    return;
  }
  if (!commit) {
    console.log(`\nDry run — ${total} rows would be inserted. Re-run with --commit to apply.`);
    return;
  }

  const inserted = await rebuild();
  console.log(
    `\nInserted: ${inserted.membershipNos} membership numbers, ` +
    `${inserted.legacyCodes} legacy codes, ${inserted.invoices} invoices.`,
  );

  const after = await countMissing();
  const remaining = after.membershipNos + after.legacyCodes + after.invoices;
  if (remaining > 0) {
    // Identifier collision (e.g. a member_code equal to another row's key)
    // requires human review — report loudly rather than guessing.
    console.error(`WARNING: ${remaining} rows still missing after rebuild — investigate identifier collisions.`);
    process.exitCode = 1;
  } else {
    console.log('Registry verified complete.');
  }
}

main().then(() => process.exit()).catch((err) => {
  console.error(err);
  process.exit(1);
});
