/**
 * M-Pesa B2C (business-to-customer disbursement): initiation, result
 * callback, and loan-disbursement side effects. Split out of
 * mpesa.service.ts (OPTIMIZATION_CLEANUP_AUDIT.md High #9).
 */

import type { PoolClient } from 'pg';
import { withAdminDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { normalizePhone } from '@/lib/utils/phone';
import { toMpesaAmount } from '@/lib/utils/currency';
import { postLoanDisbursementJournal } from './posting-templates.service';
import { initiateB2C as _b2c, assertSafaricomIp } from './daraja.service';
import { IS_SANDBOX } from './mpesa-spine.service';
import { computeB2CCharge, insertMpesaCharge, postStandaloneChargeJournal } from './mpesa-charges.service';
import { notifyDisbursementCallback } from '@/lib/queue/qstash';

// ─── B2C ─────────────────────────────────────────────────────────────────────

export interface B2CParams {
  phone:       string;
  amount:      number;
  occasion:    string;
  commandId:   'BusinessPayment' | 'SalaryPayment' | 'PromotionPayment';
  groupId:     string;
  loanId?:     string;
  disbursedBy?: string;
  remarks?:    string;
  /** Links this Daraja call back to its disbursement_requests row (spine, B2C audit C1-C5). */
  disbursementRequestId?: string;
}

export interface B2CResult {
  conversationId:           string;
  originatorConversationId: string;
  responseDescription:      string;
}

export async function initiateB2C(params: B2CParams): Promise<B2CResult> {
  const phone     = normalizePhone(params.phone);
  const amountStr = toMpesaAmount(params.amount).toFixed(2);
  const remarks   = params.remarks ?? params.occasion;

  const res = await _b2c({
    phone,
    amount:    params.amount,
    commandId: params.commandId,
    remarks,
    occasion:  params.occasion,
  });

  await withAdminDb(async (db) => {
    // Pick the source sub-account by commandId. PartyA on the Daraja call
    // stays MPESA_SHORTCODE; this column is for our reconciliation only.
    const sourceAccount =
      params.commandId === 'BusinessPayment'
        ? (process.env.MPESA_LOAN_DISBURSEMENT_SHORTCODE ?? process.env.MPESA_UTILITY_SHORTCODE ?? null)
        : (process.env.MPESA_UTILITY_SHORTCODE ?? null);

    const { rows: txRows } = await db.query<{ id: string }>(
      `INSERT INTO mpesa_transactions
         (group_id, transaction_type, direction, phone_number, amount,
          status, description, conversation_id, originator_conversation_id, is_test)
       VALUES ($1,'b2c','outbound',$2,$3,'initiated',$4,$5,$6,$7)
       RETURNING id`,
      [
        params.groupId, phone, amountStr, remarks,
        res.conversationId, res.originatorConversationId, IS_SANDBOX,
      ],
    );

    const { rows: b2cRows } = await db.query<{ id: string }>(
      `INSERT INTO mpesa_b2c_transactions
         (group_id, mpesa_transaction_id, conversation_id,
          originator_conversation_id, phone, amount, command_id,
          occasion, remarks, status, loan_id, disbursed_by, source_account,
          disbursement_request_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'initiated',$10,$11,$12,$13)
       RETURNING id`,
      [
        params.groupId, txRows[0]?.id ?? null,
        res.conversationId, res.originatorConversationId,
        phone, amountStr, params.commandId,
        params.occasion, remarks,
        params.loanId ?? null, params.disbursedBy ?? null,
        sourceAccount, params.disbursementRequestId ?? null,
      ],
    );

    if (params.disbursementRequestId) {
      await db.query(
        `UPDATE disbursement_requests SET b2c_transaction_id = $1 WHERE id = $2`,
        [b2cRows[0].id, params.disbursementRequestId],
      );
    }
  });

  return {
    conversationId:           res.conversationId,
    originatorConversationId: res.originatorConversationId,
    responseDescription:      res.responseDescription,
  };
}

// ─── B2C Callbacks ────────────────────────────────────────────────────────────

export interface B2CResultBody {
  Result: {
    ResultType:               number;
    ResultCode:               number;
    ResultDesc:               string;
    OriginatorConversationID: string;
    ConversationID:           string;
    TransactionID:            string;
    ResultParameters?: {
      ResultParameter: { Key: string; Value: unknown }[];
    };
  };
}

// What to tell the disbursement watchdog once the transaction below commits.
// Deliberately built inside the transaction and fired AFTER it (see the
// return-then-notify shape below) rather than calling
// notifyDisbursementCallback from inside withAdminDb's callback — that
// callback runs inside an explicit BEGIN/COMMIT holding this row's FOR
// UPDATE lock, and a network call to QStash has no business extending how
// long that lock is held.
interface WatchdogNotifyInfo {
  rowId:     string;
  eventData: { status: 'failed' | 'completed'; failureReason?: string; mpesaReceiptNumber?: string | null };
}

export async function handleB2CResult(body: B2CResultBody, callerIp: string): Promise<void> {
  assertSafaricomIp(callerIp);
  const r       = body.Result;
  const rawBody = JSON.stringify(body);

  const watchdogNotify = await withAdminDb(async (db): Promise<WatchdogNotifyInfo | undefined> => {
    // Capture the B2C row early — we need group_id and loan_id later.
    const { rows: b2cRows } = await db.query<{
      id:                      string;
      group_id:                string;
      loan_id:                 string | null;
      amount:                  string;
      phone:                   string;
      disbursed_by:            string | null;
      mpesa_transaction_id:    string | null;
      disbursement_request_id: string | null;
    }>(
      `SELECT id, group_id, loan_id, amount, phone, disbursed_by, mpesa_transaction_id,
              disbursement_request_id
       FROM   mpesa_b2c_transactions
       WHERE  originator_conversation_id=$1
       FOR UPDATE`,
      [r.OriginatorConversationID],
    );
    const b2c = b2cRows[0] ?? null;
    const groupId = b2c?.group_id ?? null;

    // ── Failure ──────────────────────────────────────────────────────────
    if (r.ResultCode !== 0) {
      await db.query(
        `UPDATE mpesa_b2c_transactions
         SET    status='failed', raw_result=$1, result_received_at=NOW()
         WHERE  originator_conversation_id=$2`,
        [rawBody, r.OriginatorConversationID],
      );
      await db.query(
        `UPDATE mpesa_transactions
         SET    status='failed', failure_reason=$1, raw_response=$2,
                completed_at=NOW(), is_test=$3
         WHERE  originator_conversation_id=$4`,
        [r.ResultDesc, rawBody, IS_SANDBOX, r.OriginatorConversationID],
      );
      await db.query(
        `INSERT INTO failed_payment_logs
           (group_id, transaction_type, reference_id, failure_reason, failure_code, raw_data)
         VALUES ($1,'b2c',$2,$3,$4,$5)`,
        [groupId, r.OriginatorConversationID, r.ResultDesc, String(r.ResultCode), rawBody],
      );
      // Disbursement spine (B2C audit C1/C4): release the reservation — the
      // money never left, so the group's available balance is restored.
      if (b2c?.disbursement_request_id) {
        await releaseDisbursementReservation(db, b2c.disbursement_request_id, {
          status: 'failed', failureReason: r.ResultDesc,
        });
        return { rowId: b2c.disbursement_request_id, eventData: { status: 'failed', failureReason: r.ResultDesc } };
      }
      return undefined;
    }

    // ── Success ──────────────────────────────────────────────────────────
    const get     = (k: string) => r.ResultParameters?.ResultParameter.find((p) => p.Key === k)?.Value;
    const receipt = (get('TransactionReceipt') as string | undefined) ?? null;

    await db.query(
      `UPDATE mpesa_b2c_transactions
       SET    status='completed', mpesa_receipt_number=$1,
              raw_result=$2, result_received_at=NOW()
       WHERE  originator_conversation_id=$3`,
      [receipt, rawBody, r.OriginatorConversationID],
    );
    await db.query(
      `UPDATE mpesa_transactions
       SET    status='completed', mpesa_receipt_number=$1,
              raw_response=$2, completed_at=NOW(), is_test=$3
       WHERE  originator_conversation_id=$4`,
      [receipt, rawBody, IS_SANDBOX, r.OriginatorConversationID],
    );

    // ── Charges + loan disbursement side-effect ──────────────────────────
    if (b2c) {
      const grossAmount = parseFloat(b2c.amount);
      const charge      = await computeB2CCharge(db, grossAmount);

      if (b2c.loan_id && receipt) {
        // Combined journal: DR loan receivable + DR charges expense / CR cash.
        await applyLoanDisbursement(db, {
          groupId:            b2c.group_id,
          loanId:             b2c.loan_id,
          amount:             grossAmount,
          charge,
          receipt,
          disbursedBy:        b2c.disbursed_by,
          mpesaTransactionId: b2c.mpesa_transaction_id,
        });

        // Disbursement notification (B2C audit F10) — the borrower is told
        // the money left, not just that the loan record changed. Best-effort:
        // emitBusinessEvent never throws and no-ops when no rule matches.
        const { rows: memberRows } = await db.query<{ member_id: string; first_name: string }>(
          `SELECT l.member_id, m.first_name
           FROM   loans l JOIN members m ON m.id = l.member_id
           WHERE  l.id = $1`,
          [b2c.loan_id],
        );
        if (memberRows[0]) {
          const { emitBusinessEvent } = await import('@/lib/sms/trigger-engine');
          const { SMS_EVENTS }        = await import('@/lib/sms/events');
          await emitBusinessEvent({
            eventType: SMS_EVENTS.LOAN_DISBURSED,
            eventId:   b2c.loan_id,
            groupId:   b2c.group_id,
            actorId:   memberRows[0].member_id,
            payload: {
              memberId:   memberRows[0].member_id,
              first_name: memberRows[0].first_name,
              amount:     grossAmount,
              receipt,
            },
          });
        }
      } else if (charge > 0 && b2c.mpesa_transaction_id) {
        // Non-loan B2C (welfare payout, dividend): the disbursement journal
        // is posted by its own module, but the Safaricom fee still needs to
        // hit the books. Post a standalone charge entry.
        await postStandaloneChargeJournal(db, {
          groupId:            b2c.group_id,
          amount:             charge,
          reference:          receipt ?? r.OriginatorConversationID,
          mpesaTransactionId: b2c.mpesa_transaction_id,
          chargeType:         'b2c',
        });
      }

      // Disbursement spine (B2C audit C1/C4): the money left for real —
      // release the hold (the journal above already reduced the account's
      // actual balance; the reservation's job is done) and mark completed.
      if (b2c.disbursement_request_id) {
        await releaseDisbursementReservation(db, b2c.disbursement_request_id, {
          status: 'completed', mpesaReceiptNumber: receipt,
        });
        return { rowId: b2c.disbursement_request_id, eventData: { status: 'completed', mpesaReceiptNumber: receipt } };
      }
    }
    return undefined;
  });

  // Fired after the transaction above commits (see WatchdogNotifyInfo's own
  // comment for why this must not happen from inside withAdminDb). Best-
  // effort and non-throwing — see notifyDisbursementCallback's own contract.
  if (watchdogNotify) {
    await notifyDisbursementCallback('disbursement', watchdogNotify.rowId, watchdogNotify.eventData);
  }
}

/**
 * Releases a disbursement_requests reservation on its cash account and
 * settles the row to a terminal state. Idempotent: only rows still holding a
 * reservation (status IN dispatched/approved) transition — a replayed
 * callback is a safe no-op.
 */
async function releaseDisbursementReservation(
  db:   PoolClient,
  id:   string,
  args: { status: 'completed' | 'failed'; mpesaReceiptNumber?: string | null; failureReason?: string },
): Promise<void> {
  const { rows } = await db.query<{ cash_account_id: string; amount: string }>(
    `UPDATE disbursement_requests
     SET    status = $1::disbursement_status,
            mpesa_receipt_number = COALESCE($2, mpesa_receipt_number),
            failure_reason = $3,
            completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE completed_at END
     WHERE  id = $4 AND status IN ('approved', 'dispatched')
     RETURNING cash_account_id, amount`,
    [args.status, args.mpesaReceiptNumber ?? null, args.failureReason ?? null, id],
  );
  if (!rows[0]) return; // already settled — replayed callback
  await db.query(
    `UPDATE accounts SET reserved_amount = reserved_amount - $1 WHERE id = $2`,
    [rows[0].amount, rows[0].cash_account_id],
  );
}

async function applyLoanDisbursement(
  db:   PoolClient,
  args: {
    groupId:            string;
    loanId:             string;
    amount:             number;
    charge:             number;
    receipt:            string;
    disbursedBy:        string | null;
    mpesaTransactionId: string | null;
  },
): Promise<void> {
  // Flip the loan to disbursed (state-machine guard in mig 028 enforces the
  // transition: approved → disbursed). Idempotent — re-runs no-op when the
  // loan is already in a later state.
  const { rows: loanRows } = await db.query<{ id: string }>(
    `UPDATE loans
     SET    status               = 'disbursed',
            disbursement_date    = CURRENT_DATE,
            disbursed_at         = NOW(),
            disbursed_by         = COALESCE(disbursed_by, $1),
            mpesa_receipt_number = $2,
            payment_method       = 'mpesa'
     WHERE  id = $3 AND status = 'approved'
     RETURNING id`,
    [args.disbursedBy, args.receipt, args.loanId],
  );
  if (!loanRows[0]) {
    logger.warn('[mpesa] B2C result loan not flipped — wrong status or already disbursed', {
      loanId: args.loanId,
    });
    return;
  }

  // DR Loans Receivable (principal) [+ DR charge expense, when foldable] / CR Cash.
  // Posted by the B2C result callback (system), though initiated_by (disbursedBy)
  // is retained in created_by.
  const posted = await postLoanDisbursementJournal(db, {
    groupId: args.groupId, loanId: args.loanId, principal: args.amount, charge: args.charge,
    entryDate: new Date().toISOString().slice(0, 10), reference: args.receipt,
    createdBy: args.disbursedBy, isTest: IS_SANDBOX,
  });

  // Record the fee for reconciliation against the Charges Paid sub-account.
  if (args.charge > 0 && args.mpesaTransactionId) {
    await insertMpesaCharge(db, {
      groupId:            args.groupId,
      mpesaTransactionId: args.mpesaTransactionId,
      chargeType:         'b2c',
      amount:             args.charge,
      journalEntryId:     posted?.chargePosted ? posted.journalEntryId : null,
    });
  }
}
