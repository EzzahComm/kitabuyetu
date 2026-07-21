/**
 * M-Pesa reconciliation: STK status-query sweep, PayBill orphan sweep, and
 * B2C charge backfill. Split out of mpesa.service.ts
 * (OPTIMIZATION_CLEANUP_AUDIT.md High #9).
 */

import type { PoolClient } from 'pg';
import { withAdminDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { cacheMpesaStatus } from '@/lib/redis';
import { queryStkStatus as _stkQuery } from './daraja.service';
import { postContributionJournal } from './accounting.service';
import { IS_SANDBOX } from './mpesa-spine.service';
import { routeToUnrouted, type StkRequestRow as AllocationStkRequestRow } from './mpesa-allocation.service';
import { computeB2CCharge, insertMpesaCharge, postStandaloneChargeJournal } from './mpesa-charges.service';

export interface ReconciliationResult {
  reconciliationId:    string;
  transactionsChecked: number;
  mismatchesFound:     number;
  resolvedCount:       number;
}

export interface ReconStkRow {
  id:                string;
  checkout_request_id: string;
  group_id:          string;
  purpose:           string | null;
  loan_repayment_id: string | null;
  account_reference: string;
  amount:            string;
  contribution_id:   string | null;
  phone:             string;
}

/**
 * Creates the contribution + journal for an STK that the reconciliation sweep
 * resolved to completed but whose callback never landed. Idempotent: the
 * contribution_id guard (under the caller's FOR UPDATE lock) prevents a double
 * create, and a late callback short-circuits on the already-completed payment.
 *
 * The M-Pesa receipt is unavailable here — STK Push Query doesn't return it —
 * so the contribution is recorded with a NULL receipt and a note explaining the
 * provenance. Unmatched phones still route to the unrouted queue.
 */
async function fulfilReconciledContribution(db: PoolClient, row: ReconStkRow): Promise<void> {
  if (row.contribution_id) return;            // already fulfilled
  if (row.purpose !== 'contribution') return; // only contributions auto-fulfil here

  const amount = parseFloat(row.amount);

  const { rows: memRows } = await db.query<{ id: string }>(
    `SELECT m.id
     FROM   members m
     JOIN   group_members gm ON gm.member_id = m.id
     WHERE  m.phone = $1 AND gm.group_id = $2
       AND  gm.status = 'active' AND m.is_active = true
     LIMIT  1`,
    [row.phone, row.group_id],
  );
  const memberId = memRows[0]?.id ?? null;

  if (!memberId) {
    // Surrogate receipt = checkout id (mpesa_unrouted.receipt is NOT NULL/UNIQUE).
    const stkReq: AllocationStkRequestRow = {
      id: row.id, group_id: row.group_id, purpose: row.purpose, invoice_id: null,
      loan_repayment_id: row.loan_repayment_id, account_reference: row.account_reference,
      amount: row.amount,
    };
    await routeToUnrouted(
      db,
      stkReq,
      {
        receipt: row.checkout_request_id, amount, phone: row.phone,
        rawBody: JSON.stringify({ reconciled: true, checkout: row.checkout_request_id }),
      },
      { reason: 'unknown_member', candidateGroupId: row.group_id },
    );
    return;
  }

  const { rows: cRows } = await db.query<{ id: string }>(
    `INSERT INTO contributions
       (group_id, member_id, group_membership_id, amount, contribution_date,
        status, payment_method, mpesa_receipt_number, notes, recorded_by)
     VALUES ($1,$2,
             (SELECT gm.id FROM group_members gm
              WHERE gm.group_id = $1 AND gm.member_id = $2),
             $3,CURRENT_DATE,'completed','mpesa',NULL,$4,NULL)
     RETURNING id`,
    [
      row.group_id, memberId, amount.toFixed(2),
      `Reconciled from STK ${row.account_reference} — callback not received; M-Pesa receipt unavailable`,
    ],
  );
  const contributionId = cRows[0].id;

  await postContributionJournal(db, {
    groupId: row.group_id, contributionId, amount,
    entryDate: new Date().toISOString().slice(0, 10), reference: row.checkout_request_id,
    createdBy: null, isTest: IS_SANDBOX,
  });

  await db.query(`UPDATE mpesa_stk_requests SET contribution_id=$1 WHERE id=$2`, [contributionId, row.id]);
  logger.warn('[mpesa] reconcile self-healed a lost contribution callback', { stkId: row.id, contributionId });
}

export async function runReconciliation(
  groupId: string | null,
  initiatedBy: string | null,
): Promise<ReconciliationResult> {
  const { rows: runRows } = await withAdminDb((db) =>
    db.query<{ id: string }>(
      `INSERT INTO mpesa_reconciliations (group_id, initiated_by, status)
       VALUES ($1,$2,'running') RETURNING id`,
      [groupId, initiatedBy],
    ),
  );
  const runId = runRows[0].id;

  let checked = 0, mismatches = 0, resolved = 0;
  const details: unknown[] = [];

  try {
    const stale = await withAdminDb(async (db) => {
      const cutoff = new Date(Date.now() - 5 * 60_000);
      const { rows } = groupId
        ? await db.query<{ id: string; checkout_request_id: string }>(
            `SELECT id, checkout_request_id FROM mpesa_stk_requests
             WHERE status='pending' AND initiated_at<$1 AND group_id=$2 LIMIT 50`,
            [cutoff, groupId],
          )
        : await db.query<{ id: string; checkout_request_id: string }>(
            `SELECT id, checkout_request_id FROM mpesa_stk_requests
             WHERE status='pending' AND initiated_at<$1 LIMIT 50`,
            [cutoff],
          );
      return rows;
    });

    checked = stale.length;

    for (const req of stale) {
      try {
        const statusRes = await _stkQuery(req.checkout_request_id);
        mismatches++;

        const isDone = statusRes.resultCode !== '1032'; // 1032 = request in process
        if (!isDone) continue;

        const newStatus = statusRes.resultCode === '0' ? 'completed' : 'failed';

        await withAdminDb(async (db) => {
          // Lock the STK row so a late callback and this sweep can't both fulfil.
          const { rows: full } = await db.query<ReconStkRow>(
            `SELECT id, checkout_request_id, group_id, purpose, loan_repayment_id,
                    account_reference, amount, contribution_id::text AS contribution_id, phone
             FROM   mpesa_stk_requests WHERE id=$1 FOR UPDATE`,
            [req.id],
          );
          const row = full[0];

          await db.query(
            `UPDATE mpesa_stk_requests SET status=$1, completed_at=NOW() WHERE id=$2`,
            [newStatus, req.id],
          );
          await db.query(
            `UPDATE payments SET status=$1
             WHERE mpesa_checkout_request_id=$2 AND status='pending'`,
            [newStatus, req.checkout_request_id],
          );

          // Self-heal: a payment that completed but whose callback was lost
          // (e.g. 403'd / dropped) gets its contribution + journal created here.
          if (newStatus === 'completed' && row) {
            await fulfilReconciledContribution(db, row);
          }
        });
        await cacheMpesaStatus(req.checkout_request_id, newStatus as 'completed' | 'failed');
        resolved++;
        details.push({ id: req.id, action: `resolved_${newStatus}`, code: statusRes.resultCode });
      } catch {
        details.push({ id: req.id, action: 'query_error' });
      }
    }

    await withAdminDb((db) =>
      db.query(
        `UPDATE mpesa_reconciliations
         SET status='completed', transactions_checked=$1, mismatches_found=$2,
             resolved_count=$3, details=$4, completed_at=NOW()
         WHERE id=$5`,
        [checked, mismatches, resolved, JSON.stringify(details), runId],
      ),
    );
  } catch (err) {
    await withAdminDb((db) =>
      db.query(
        `UPDATE mpesa_reconciliations SET status='failed', notes=$1 WHERE id=$2`,
        [String(err), runId],
      ),
    );
    throw err;
  }

  return { reconciliationId: runId, transactionsChecked: checked, mismatchesFound: mismatches, resolvedCount: resolved };
}

/**
 * Paybill sweep reconciliation — detects completed inbound C2B (paybill)
 * transactions that were recorded on the money ledger but never produced a
 * domain record (contribution, loan repayment, or invoice payment) and are
 * not already sitting in the unrouted queue. These are "partial updates" —
 * the payment landed but its fulfilment step failed midway.
 *
 * Detected orphans are queued into mpesa_unrouted for treasurer resolution
 * (allocate / dismiss). Fully idempotent: mpesa_unrouted.receipt is UNIQUE,
 * so a receipt is queued at most once regardless of how often the sweep runs.
 */
export async function sweepPaybillTransactions(
  groupId: string | null,
  initiatedBy: string | null,
): Promise<ReconciliationResult> {
  const { rows: runRows } = await withAdminDb((db) =>
    db.query<{ id: string }>(
      `INSERT INTO mpesa_reconciliations (group_id, initiated_by, status, reconciliation_type)
       VALUES ($1,$2,'running','paybill_sweep') RETURNING id`,
      [groupId, initiatedBy],
    ),
  );
  const runId = runRows[0].id;

  let checked = 0, orphaned = 0, queued = 0;
  const details: unknown[] = [];

  try {
    await withAdminDb(async (db) => {
      const params: unknown[] = [];
      let groupFilter = '';
      if (groupId) {
        params.push(groupId);
        groupFilter = `AND t.group_id = $${params.length}`;
      }

      // Total C2B volume examined in the window (for the run report).
      const { rows: countRows } = await db.query<{ n: string }>(
        `SELECT COUNT(*) AS n
         FROM   mpesa_transactions t
         WHERE  t.transaction_type = 'c2b' AND t.direction = 'inbound'
           AND  t.created_at > NOW() - INTERVAL '24 hours' ${groupFilter}`,
        params,
      );
      checked = parseInt(countRows[0]?.n ?? '0', 10);

      // Orphans: completed C2B receipts with no domain fulfilment anywhere.
      const { rows: orphans } = await db.query<{
        id:                   string;
        group_id:             string;
        mpesa_receipt_number: string;
        phone_number:         string | null;
        amount:               string;
        reference:            string | null;
        raw_response:         unknown;
      }>(
        `SELECT t.id, t.group_id, t.mpesa_receipt_number, t.phone_number,
                t.amount, t.reference, t.raw_response
         FROM   mpesa_transactions t
         WHERE  t.transaction_type = 'c2b'
           AND  t.direction = 'inbound'
           AND  t.status = 'completed'
           AND  t.mpesa_receipt_number IS NOT NULL
           AND  t.amount > 0
           AND  t.created_at > NOW() - INTERVAL '24 hours'
           ${groupFilter}
           AND NOT EXISTS (SELECT 1 FROM contributions c
                           WHERE c.mpesa_receipt_number = t.mpesa_receipt_number)
           AND NOT EXISTS (SELECT 1 FROM loan_repayments lr
                           WHERE lr.mpesa_receipt_number = t.mpesa_receipt_number)
           AND NOT EXISTS (SELECT 1 FROM payments p
                           WHERE p.mpesa_receipt_number = t.mpesa_receipt_number
                             AND p.invoice_id IS NOT NULL)
           AND NOT EXISTS (SELECT 1 FROM mpesa_unrouted u
                           WHERE u.receipt = t.mpesa_receipt_number)
         ORDER  BY t.created_at ASC
         LIMIT  100`,
        params,
      );
      orphaned = orphans.length;

      for (const txn of orphans) {
        const rawPayload = txn.raw_response != null
          ? JSON.stringify(txn.raw_response)
          : JSON.stringify({ sweep: true, mpesaTransactionId: txn.id, billRef: txn.reference });

        const { rowCount } = await db.query(
          `INSERT INTO mpesa_unrouted
             (mpesa_transaction_id, receipt, phone, amount, bill_ref,
              reason, raw_payload, candidate_group_id)
           VALUES ($1,$2,$3,$4,$5,'other',$6::jsonb,$7)
           ON CONFLICT (receipt) DO NOTHING`,
          [
            txn.id, txn.mpesa_receipt_number, txn.phone_number ?? '',
            txn.amount, txn.reference, rawPayload, txn.group_id,
          ],
        );
        if (rowCount) {
          queued++;
          details.push({
            receipt: txn.mpesa_receipt_number,
            amount:  txn.amount,
            action:  'queued_unrouted',
            reason:  'completed C2B with no domain record (contribution/repayment/invoice)',
          });
        }
      }
    });

    await withAdminDb((db) =>
      db.query(
        `UPDATE mpesa_reconciliations
         SET status='completed', transactions_checked=$1, mismatches_found=$2,
             resolved_count=$3, details=$4, completed_at=NOW()
         WHERE id=$5`,
        [checked, orphaned, queued, JSON.stringify(details), runId],
      ),
    );

    logger.info('[mpesa] paybill sweep complete', { runId, checked, orphaned, queued });
  } catch (err) {
    await withAdminDb((db) =>
      db.query(
        `UPDATE mpesa_reconciliations SET status='failed', notes=$1 WHERE id=$2`,
        [String(err), runId],
      ),
    );
    logger.error('[mpesa] paybill sweep failed', { runId, error: err });
    throw err;
  }

  return { reconciliationId: runId, transactionsChecked: checked, mismatchesFound: orphaned, resolvedCount: queued };
}

/**
 * Charge-backfill reconciliation. Catches B2C transactions that completed but
 * never got an mpesa_charges row (e.g. the inline charge step failed). Computes
 * the deterministic fee, posts a standalone charge journal, and records it.
 */
export async function reconcileCharges(): Promise<{ examined: number; backfilled: number }> {
  const rows = await withAdminDb((db) =>
    db.query<{ id: string; group_id: string; amount: string }>(
      `SELECT t.id, t.group_id, t.amount
       FROM   mpesa_transactions t
       WHERE  t.transaction_type = 'b2c'
         AND  t.status = 'completed'
         AND  t.completed_at < NOW() - INTERVAL '10 minutes'
         AND  NOT EXISTS (
                SELECT 1 FROM mpesa_charges c WHERE c.mpesa_transaction_id = t.id
              )
       LIMIT  200`,
    ).then((r) => r.rows),
  );

  let backfilled = 0;
  for (const row of rows) {
    await withAdminDb(async (db) => {
      const charge = await computeB2CCharge(db, parseFloat(row.amount));
      if (charge <= 0) {
        // No fee for this tier — record a zero-charge row so we stop re-examining it.
        await insertMpesaCharge(db, {
          groupId: row.group_id, mpesaTransactionId: row.id,
          chargeType: 'b2c', amount: 0, journalEntryId: null,
        });
        return;
      }
      await postStandaloneChargeJournal(db, {
        groupId:            row.group_id,
        amount:             charge,
        reference:          `backfill-${row.id}`,
        mpesaTransactionId: row.id,
        chargeType:         'b2c',
      });
    }).then(() => { backfilled++; }).catch((err) => {
      logger.error('[mpesa] charge backfill failed', { txId: row.id, err: String(err) });
    });
  }
  return { examined: rows.length, backfilled };
}
