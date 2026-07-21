/**
 * Safaricom B2C/B2B transaction-fee handling, shared by the B2C flow and the
 * reconciliation charge-backfill job. Split out of mpesa.service.ts
 * (OPTIMIZATION_CLEANUP_AUDIT.md High #9).
 */

import type { PoolClient } from 'pg';
import { logger } from '@/lib/logger';
import { IS_SANDBOX } from './mpesa-spine.service';

// Safaricom B2C/B2B transaction fees (debited from the Charges Paid sub-account)
// are booked against this expense code. The seeded chart (mig 032) has no
// dedicated charges account, so we use Administrative Expenses. The exact fee
// per transaction is recorded separately in mpesa_charges for reconciliation.
export const CHARGE_EXPENSE_CODE = '5001';

/** Deterministic Safaricom fee lookup via the seeded tier table (mig 047). */
export async function computeB2CCharge(db: PoolClient, amount: number): Promise<number> {
  const { rows } = await db.query<{ charge: string | null }>(
    `SELECT mpesa_charge_for_amount($1, 'b2c') AS charge`,
    [amount.toFixed(2)],
  );
  const raw = rows[0]?.charge;
  return raw != null ? parseFloat(raw) : 0;
}

/**
 * Records the Safaricom fee in mpesa_charges. Idempotent — the UNIQUE
 * (mpesa_transaction_id) constraint makes a duplicate callback a no-op.
 */
export async function insertMpesaCharge(
  db:   PoolClient,
  args: {
    groupId:            string;
    mpesaTransactionId: string;
    chargeType:         'b2c' | 'b2b' | 'reversal' | 'stk_push' | 'other';
    amount:             number;
    journalEntryId:     string | null;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO mpesa_charges
       (group_id, mpesa_transaction_id, charge_type, amount, source, journal_entry_id)
     VALUES ($1,$2,$3,$4,'tier_table',$5)
     ON CONFLICT (mpesa_transaction_id) DO NOTHING`,
    [args.groupId, args.mpesaTransactionId, args.chargeType, args.amount.toFixed(2), args.journalEntryId],
  );
}

/**
 * Posts a charge-only journal entry (DR admin expense / CR cash) for B2C/B2B
 * flows whose principal disbursement journal lives in another module.
 */
export async function postStandaloneChargeJournal(
  db:   PoolClient,
  args: {
    groupId:            string;
    amount:             number;
    reference:          string;
    mpesaTransactionId: string;
    chargeType:         'b2c' | 'b2b' | 'reversal' | 'stk_push' | 'other';
  },
): Promise<void> {
  const cashCode   = '1001';
  const expenseCode = CHARGE_EXPENSE_CODE;

  const { rows: accts } = await db.query<{ code: string; id: string }>(
    `SELECT account_code AS code, id FROM accounts
     WHERE group_id = $1 AND is_active = true AND account_code IN ($2, $3)`,
    [args.groupId, cashCode, expenseCode],
  );
  const cashId    = accts.find((a) => a.code === cashCode)?.id;
  const expenseId = accts.find((a) => a.code === expenseCode)?.id;
  if (!cashId || !expenseId) {
    logger.warn('[mpesa] skipped charge journal — chart missing 1001/5001', { groupId: args.groupId });
    // Still record the charge for reconciliation even if we can't post it.
    await insertMpesaCharge(db, { ...args, journalEntryId: null });
    return;
  }

  const { rows: jeRows } = await db.query<{ id: string }>(
    `INSERT INTO journal_entries
       (group_id, entry_date, reference, description, status, created_by, posted_at, is_test, posted_via)
     VALUES ($1, CURRENT_DATE, $2, $3, 'posted', NULL, NOW(), $4, 'system')
     RETURNING id`,
    [args.groupId, args.reference, `M-Pesa ${args.chargeType.toUpperCase()} transaction charge`, IS_SANDBOX],
  );
  const jeId = jeRows[0].id;

  // entry_date is the journal_lines partition key — supplied directly as the
  // same CURRENT_DATE literal used for the parent journal_entries row above
  // (a BEFORE INSERT trigger deriving it after Postgres has already routed
  // the row to a partition is unsupported).
  await db.query(
    `INSERT INTO journal_lines (group_id, journal_entry_id, account_id, debit, credit, entry_date)
     VALUES ($1,$2,$3,$4,0,CURRENT_DATE), ($1,$2,$5,0,$4,CURRENT_DATE)`,
    [args.groupId, jeId, expenseId, args.amount.toFixed(2), cashId],
  );

  await insertMpesaCharge(db, { ...args, journalEntryId: jeId });
}
