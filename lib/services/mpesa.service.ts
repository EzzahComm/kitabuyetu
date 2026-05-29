/**
 * M-Pesa orchestration layer.
 *
 * Wraps daraja.service.ts (raw Daraja API calls) and handles:
 *  - Dual-writes to dedicated M-Pesa tables AND the legacy payments table.
 *  - Idempotency — MpesaReceiptNumber is the primary idempotency key.
 *  - Redis status cache for fast frontend polling.
 *  - IP verification delegated to daraja.service.assertSafaricomIp.
 */

import type { PoolClient } from 'pg';
import { withAdminDb, withTransaction, withDb, type TenantContext } from '@/lib/db';
import { NotFoundError } from '@/lib/utils/errors';
import { cacheMpesaStatus } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { normalizePhone } from '@/lib/utils/phone';
import { toMpesaAmount } from '@/lib/utils/currency';
import { parseBillRefNumber, isSandboxTestRef, type RoutingDecision } from '@/lib/utils/mpesa-bill-ref';
import { allocateSplit } from '@/lib/utils/split-allocator';
import { loadActiveSplitRules } from './contribution-splits.service';
import { notifyMember } from './notifications.service';
import {
  initiateStkPush    as _stkPush,
  initiateB2C        as _b2c,
  buyAirtime         as _buyAirtime,
  registerC2BUrls    as _registerC2B,
  queryStkStatus     as _stkQuery,
  assertSafaricomIp,
  type B2CInput,
  type C2BApiVersion,
} from './daraja.service';

// Re-export helpers used directly by routes
export { assertSafaricomIp };

// Sandbox env stamps `is_test=true` on every M-Pesa row + downstream journal
// entry so a single DELETE WHERE is_test wipes test data pre-production.
const IS_SANDBOX = (process.env.MPESA_ENV ?? 'sandbox') !== 'production';

// Safaricom B2C/B2B transaction fees (debited from the Charges Paid sub-account)
// are booked against this expense code. The seeded chart (mig 032) has no
// dedicated charges account, so we use Administrative Expenses. The exact fee
// per transaction is recorded separately in mpesa_charges for reconciliation.
const CHARGE_EXPENSE_CODE = '5001';

// ─── C2B registration ─────────────────────────────────────────────────────────

export async function registerC2BUrls(version?: C2BApiVersion): Promise<void> {
  return _registerC2B(version);
}

// ─── STK Push ────────────────────────────────────────────────────────────────

export interface StkPushParams {
  phone:            string;
  amount:           number;
  accountReference: string;
  description:      string;
  groupId:          string;
  invoiceId?:       string;
  purpose?:         string;
  initiatedBy?:     string;
}

export interface StkPushResult {
  checkoutRequestId:   string;
  merchantRequestId:   string;
  responseCode:        string;
  responseDescription: string;
}

export async function initiateSTKPush(params: StkPushParams): Promise<StkPushResult> {
  const phone     = normalizePhone(params.phone);
  const amountStr = toMpesaAmount(params.amount).toFixed(2);

  const res = await _stkPush({
    phone,
    amount:           params.amount,
    accountReference: params.accountReference,
    description:      params.description,
  });

  await withAdminDb(async (db) => {
    // 1. Master transaction ledger
    const { rows: txRows } = await db.query<{ id: string }>(
      `INSERT INTO mpesa_transactions
         (group_id, transaction_type, direction, phone_number, amount,
          status, reference, description, raw_request, is_test)
       VALUES ($1,'stk_push','inbound',$2,$3,'pending',$4,$5,$6,$7)
       RETURNING id`,
      [
        params.groupId, phone, amountStr,
        params.accountReference, params.description,
        JSON.stringify({ checkoutRequestId: res.checkoutRequestId }),
        IS_SANDBOX,
      ],
    );
    const txId = txRows[0]?.id ?? null;

    // 2. STK-specific tracking
    await db.query(
      `INSERT INTO mpesa_stk_requests
         (group_id, mpesa_transaction_id, checkout_request_id, merchant_request_id,
          phone, amount, account_reference, description, purpose,
          status, invoice_id, initiated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$11)
       ON CONFLICT (checkout_request_id) DO NOTHING`,
      [
        params.groupId, txId,
        res.checkoutRequestId, res.merchantRequestId,
        phone, amountStr,
        params.accountReference.slice(0, 12),
        params.description.slice(0, 20),
        params.purpose ?? null,
        params.invoiceId ?? null,
        params.initiatedBy ?? null,
      ],
    );

    // 3. Legacy payments table (accounting / billing side)
    await db.query(
      `INSERT INTO payments
         (group_id, invoice_id, amount, payment_method, status,
          mpesa_checkout_request_id, mpesa_merchant_request_id, mpesa_phone)
       VALUES ($1,$2,$3,'mpesa','pending',$4,$5,$6)
       ON CONFLICT (mpesa_checkout_request_id) DO NOTHING`,
      [
        params.groupId, params.invoiceId ?? null, amountStr,
        res.checkoutRequestId, res.merchantRequestId, phone,
      ],
    );
  });

  await cacheMpesaStatus(res.checkoutRequestId, 'pending');

  return {
    checkoutRequestId:   res.checkoutRequestId,
    merchantRequestId:   res.merchantRequestId,
    responseCode:        res.responseCode,
    responseDescription: res.responseDescription,
  };
}

// ─── STK Callback ────────────────────────────────────────────────────────────

export interface StkCallbackBody {
  Body: {
    stkCallback: {
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResultCode:        number;
      ResultDesc:        string;
      CallbackMetadata?: {
        Item: { Name: string; Value: unknown }[];
      };
    };
  };
}

export interface StkCallbackResult {
  success:            boolean;
  mpesaReceiptNumber: string | null;
  amount:             number | null;
  paymentId:          string | null;
}

interface StkRequestRow {
  id:                 string;
  group_id:           string;
  purpose:            string | null;
  invoice_id:         string | null;
  loan_repayment_id:  string | null;
  account_reference:  string;
  amount:             string;
}

export async function handleSTKCallback(
  body: StkCallbackBody,
  callerIp: string,
  opts?: { skipIpCheck?: boolean },
): Promise<StkCallbackResult> {
  if (!opts?.skipIpCheck) assertSafaricomIp(callerIp);

  const cb       = body.Body.stkCallback;
  const rawBody  = JSON.stringify(body);

  // ── Failure branch ─────────────────────────────────────────────────────────
  if (cb.ResultCode !== 0) {
    // The STK request row carries everything the fallback SMS needs. The
    // status-guarded UPDATE … RETURNING also acts as a first-transition latch
    // so a duplicate/ replayed failure callback won't re-send the SMS.
    const failed = await withAdminDb(async (db) => {
      const { rows: stkRows } = await db.query<{
        group_id:          string;
        phone:             string;
        amount:            string;
        account_reference: string;
        purpose:           string | null;
      }>(
        `UPDATE mpesa_stk_requests
         SET    status='failed', completed_at=NOW(), raw_callback=$2
         WHERE  checkout_request_id=$1 AND status NOT IN ('failed','completed')
         RETURNING group_id, phone, amount, account_reference, purpose`,
        [cb.CheckoutRequestID, rawBody],
      );
      const stk = stkRows[0] ?? null;

      // Fall back to a plain SELECT for group_id if the row already transitioned
      // (so failed_payment_logs still gets the FK on a duplicate callback).
      const groupId = stk?.group_id ?? (await db.query<{ group_id: string | null }>(
        `SELECT group_id FROM mpesa_stk_requests WHERE checkout_request_id=$1 LIMIT 1`,
        [cb.CheckoutRequestID],
      )).rows[0]?.group_id ?? null;

      await db.query(
        `UPDATE payments SET status='failed'
         WHERE mpesa_checkout_request_id=$1 AND status='pending'`,
        [cb.CheckoutRequestID],
      );
      await db.query(
        `UPDATE mpesa_transactions t
         SET status='failed', failure_reason=$2, raw_response=$3, completed_at=NOW()
         FROM mpesa_stk_requests s
         WHERE s.mpesa_transaction_id=t.id AND s.checkout_request_id=$1`,
        [cb.CheckoutRequestID, cb.ResultDesc, rawBody],
      );
      await db.query(
        `INSERT INTO failed_payment_logs
           (group_id, transaction_type, reference_id, failure_reason, failure_code, raw_data)
         VALUES ($1,'stk_push',$2,$3,$4,$5)`,
        [groupId, cb.CheckoutRequestID, cb.ResultDesc, String(cb.ResultCode), rawBody],
      );

      return stk; // null when this is a duplicate/replayed failure
    });

    await cacheMpesaStatus(cb.CheckoutRequestID, 'failed');

    // First-transition only: nudge the member toward the PayBill fallback.
    if (failed) {
      await sendStkFallback(failed, cb.ResultCode).catch((err) =>
        logger.error('[mpesa] STK fallback SMS failed', { err: String(err) }),
      );
    }

    return { success: false, mpesaReceiptNumber: null, amount: null, paymentId: null };
  }

  // ── Success branch (all in one transaction) ────────────────────────────────
  const items   = cb.CallbackMetadata!.Item;
  const getItem = (name: string) => items.find((i) => i.Name === name)?.Value;
  const receipt = getItem('MpesaReceiptNumber') as string;
  const amount  = getItem('Amount') as number;
  const phone   = normalizePhone(String(getItem('PhoneNumber') ?? ''));

  const result = await withAdminDb(async (db) => {
    // 1. Idempotency: if this receipt is already completed, no-op.
    const { rows: existingRows } = await db.query<{ id: string; status: string }>(
      `SELECT id, status FROM payments
       WHERE mpesa_receipt_number=$1 OR mpesa_checkout_request_id=$2
       LIMIT 1`,
      [receipt, cb.CheckoutRequestID],
    );
    const existing = existingRows[0];
    if (existing?.status === 'completed') {
      return { paymentId: existing.id, alreadyDone: true };
    }

    // 2. Lock the STK request row (FOR UPDATE) so duplicate callbacks serialise.
    const { rows: stkRows } = await db.query<StkRequestRow>(
      `SELECT id, group_id, purpose, invoice_id, loan_repayment_id,
              account_reference, amount
       FROM   mpesa_stk_requests
       WHERE  checkout_request_id=$1
       FOR UPDATE`,
      [cb.CheckoutRequestID],
    );
    const stkReq = stkRows[0] ?? null;

    // 3. Mark payments / invoices / m-pesa rows completed.
    const { rows: payRows } = await db.query<{ id: string; invoice_id: string | null }>(
      `UPDATE payments
       SET    status='completed', mpesa_receipt_number=$1,
              mpesa_raw_callback=$2, payment_date=NOW()
       WHERE  mpesa_checkout_request_id=$3 AND status='pending'
       RETURNING id, invoice_id`,
      [receipt, rawBody, cb.CheckoutRequestID],
    );
    const paymentId = payRows[0]?.id ?? null;

    if (payRows[0]?.invoice_id) {
      await db.query(
        `UPDATE invoices
         SET paid_amount=paid_amount+$1,
             status=CASE WHEN paid_amount+$1>=total_amount THEN 'completed'::payment_status
                         ELSE status END
         WHERE id=$2`,
        [amount.toFixed(2), payRows[0].invoice_id],
      );
    }

    await db.query(
      `UPDATE mpesa_stk_requests
       SET    status='completed', raw_callback=$1, completed_at=NOW()
       WHERE  checkout_request_id=$2`,
      [rawBody, cb.CheckoutRequestID],
    );

    await db.query(
      `UPDATE mpesa_transactions t
       SET    status='completed', mpesa_receipt_number=$1,
              raw_response=$2, completed_at=NOW(), phone_number=$3,
              is_test=$5
       FROM   mpesa_stk_requests s
       WHERE  s.mpesa_transaction_id=t.id AND s.checkout_request_id=$4`,
      [receipt, rawBody, phone, cb.CheckoutRequestID, IS_SANDBOX],
    );

    // 4. Domain-level fulfilment (the new wiring).
    if (stkReq) {
      await fulfilStkCallback(db, stkReq, { receipt, amount, phone, rawBody });
    }

    return { paymentId, alreadyDone: false };
  });

  await cacheMpesaStatus(cb.CheckoutRequestID, 'completed');
  return {
    success:            true,
    mpesaReceiptNumber: receipt,
    amount,
    paymentId:          result.paymentId,
  };
}

// ─── STK fulfilment helpers ───────────────────────────────────────────────────

interface FulfilmentInput {
  receipt:  string;
  amount:   number;
  phone:    string;
  rawBody:  string;
}

/**
 * Routes a completed STK Push to its domain side-effect based on the
 * request's `purpose` / `loan_repayment_id`. Idempotent — every INSERT
 * uses `ON CONFLICT DO NOTHING` keyed on `mpesa_receipt_number`.
 */
async function fulfilStkCallback(
  db:     PoolClient,
  stkReq: StkRequestRow,
  in_:    FulfilmentInput,
): Promise<void> {
  // Loan repayment — pre-bound at initiation time
  if (stkReq.loan_repayment_id) {
    await applyLoanRepayment(db, stkReq, in_);
    return;
  }

  // Contribution — look up member by phone in the group
  if (stkReq.purpose === 'contribution') {
    await applyContributionFromSTK(db, stkReq, in_);
    return;
  }

  // Other purposes (registration, subscription, sms_topup) are handled by
  // the existing billing pipeline via the payments/invoices update above —
  // no domain action needed here.
}

async function applyContributionFromSTK(
  db:     PoolClient,
  stkReq: StkRequestRow,
  in_:    FulfilmentInput,
): Promise<void> {
  // Resolve the member by phone within the group. Active membership only.
  const { rows: memberRows } = await db.query<{ id: string }>(
    `SELECT m.id
     FROM   members m
     JOIN   group_members gm ON gm.member_id = m.id
     WHERE  m.phone   = $1
       AND  gm.group_id = $2
       AND  gm.is_active = true
       AND  m.is_active  = true
     LIMIT  1`,
    [in_.phone, stkReq.group_id],
  );
  const memberId = memberRows[0]?.id ?? null;

  if (!memberId) {
    await routeToUnrouted(db, stkReq, in_, {
      reason: 'unknown_member',
      candidateGroupId: stkReq.group_id,
    });
    return;
  }

  // Insert the contribution. ON CONFLICT preserves idempotency under
  // duplicate Safaricom callbacks (same receipt → no second row).
  const { rows: contribRows } = await db.query<{ id: string }>(
    `INSERT INTO contributions
       (group_id, member_id, amount, contribution_date,
        status, payment_method, mpesa_receipt_number, notes, recorded_by)
     VALUES ($1, $2, $3, CURRENT_DATE, 'completed', 'mpesa', $4, $5, NULL)
     ON CONFLICT (mpesa_receipt_number) DO NOTHING
     RETURNING id`,
    [
      stkReq.group_id,
      memberId,
      in_.amount.toFixed(2),
      in_.receipt,
      `Auto-routed from STK ref ${stkReq.account_reference}`,
    ],
  );
  const contributionId = contribRows[0]?.id ?? null;
  if (!contributionId) return; // duplicate — nothing more to do

  // Post the matching journal entry (DR cash / CR member savings).
  await postContributionJournal(db, {
    groupId:        stkReq.group_id,
    contributionId,
    amount:         in_.amount,
    reference:      in_.receipt,
  });

  // Stamp the back-pointer on the STK request for traceability.
  await db.query(
    `UPDATE mpesa_stk_requests SET contribution_id=$1 WHERE id=$2`,
    [contributionId, stkReq.id],
  );
}

async function applyLoanRepayment(
  db:     PoolClient,
  stkReq: StkRequestRow,
  in_:    FulfilmentInput,
): Promise<void> {
  // Mark the pre-bound repayment row paid. Guard against double-callback by
  // requiring status='pending'.
  const { rows: rpRows } = await db.query<{ id: string; loan_id: string; member_id: string }>(
    `UPDATE loan_repayments
     SET    status='completed',
            amount_paid          = $1,
            payment_date         = CURRENT_DATE,
            payment_method       = 'mpesa',
            mpesa_receipt_number = $2
     WHERE  id=$3 AND status='pending'
     RETURNING id, loan_id, member_id`,
    [in_.amount.toFixed(2), in_.receipt, stkReq.loan_repayment_id],
  );
  const repayment = rpRows[0];
  if (!repayment) return; // already paid OR receipt duplicate caught by UNIQUE

  await postLoanRepaymentJournal(db, {
    groupId:    stkReq.group_id,
    repaymentId: repayment.id,
    loanId:     repayment.loan_id,
    amount:     in_.amount,
    reference:  in_.receipt,
  });
}

/**
 * Records a receipt that the auto-router couldn't bind to a domain entity.
 * Treasurer-resolved later via /mpesa/unrouted.
 */
async function routeToUnrouted(
  db:     PoolClient,
  stkReq: StkRequestRow | null,
  in_:    FulfilmentInput,
  opts:   {
    reason: 'unknown_member' | 'unknown_group' | 'unknown_prefix' |
            'ambiguous_member' | 'no_account_ref' | 'amount_mismatch' | 'other';
    candidateGroupId?: string | null;
    billRef?: string | null;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO mpesa_unrouted
       (mpesa_transaction_id, receipt, phone, amount, bill_ref,
        reason, raw_payload, candidate_group_id)
     SELECT t.id, $1, $2, $3, $4, $5, $6::jsonb, $7
     FROM   mpesa_stk_requests s
     LEFT JOIN mpesa_transactions t ON t.id = s.mpesa_transaction_id
     WHERE  s.id = $8
     ON CONFLICT (receipt) DO NOTHING`,
    [
      in_.receipt,
      in_.phone,
      in_.amount.toFixed(2),
      opts.billRef ?? stkReq?.account_reference ?? null,
      opts.reason,
      in_.rawBody,
      opts.candidateGroupId ?? null,
      stkReq?.id ?? null,
    ],
  );
  logger.warn('[mpesa] routed to unrouted queue', {
    receipt: in_.receipt,
    reason:  opts.reason,
    phone:   in_.phone,
  });
}

// ─── STK failure → PayBill fallback nudge ─────────────────────────────────────

interface FailedStkRow {
  group_id:          string;
  phone:             string;
  amount:            string;
  account_reference: string;
  purpose:           string | null;
}

/**
 * Human-readable reason for the common Daraja STK result codes. Drives the
 * fallback SMS copy. We deliberately do NOT auto-retry the STK — that
 * surprises members and risks duplicate charges; we point them to PayBill.
 */
function stkFailureReason(code: number): string {
  switch (code) {
    case 1032: return 'was cancelled';
    case 1037: return 'timed out with no response';
    case 1:    return 'failed due to insufficient M-Pesa balance';
    case 2001: return 'failed due to an incorrect M-Pesa PIN';
    default:   return 'could not be completed';
  }
}

/**
 * Sends a one-off SMS/WhatsApp nudge after a failed STK prompt, pointing the
 * member at the PayBill fallback with their account reference pre-filled.
 * Only fires for payment-collection purposes (contribution / loan repayment);
 * billing flows (registration, subscription, sms_topup) have their own UX.
 */
async function sendStkFallback(stk: FailedStkRow, resultCode: number): Promise<void> {
  if (stk.purpose && !['contribution', 'loan_repayment'].includes(stk.purpose)) return;

  const member = await withAdminDb((db) =>
    db.query<{ id: string }>(
      `SELECT m.id
       FROM   members m
       JOIN   group_members gm ON gm.member_id = m.id
       WHERE  m.phone = $1 AND gm.group_id = $2
         AND  gm.is_active = true AND m.is_active = true
       LIMIT  1`,
      [stk.phone, stk.group_id],
    ).then((r) => r.rows[0] ?? null),
  );
  if (!member) return; // can't attribute the nudge — skip

  const paybill = process.env.MPESA_WORKING_SHORTCODE ?? process.env.MPESA_SHORTCODE ?? '';
  const amount  = Math.round(parseFloat(stk.amount));
  const body =
    `KitabuYetu: Your M-Pesa payment of KES ${amount} ${stkFailureReason(resultCode)}. ` +
    `To complete it, pay via PayBill ${paybill}, Account ${stk.account_reference}. ` +
    `Reply HELP for support.`;

  await notifyMember({
    groupId:       stk.group_id,
    memberId:      member.id,
    phone:         stk.phone,
    body,
    referenceType: 'stk_fallback',
  });
}

// ─── Journal posting helpers ─────────────────────────────────────────────────

async function postContributionJournal(
  db:   PoolClient,
  args: { groupId: string; contributionId: string; amount: number; reference: string },
): Promise<void> {
  const cashCode        = '1001';   // Cash:M-Pesa (debit)
  const defaultIncome   = '4001';   // Member savings / contribution income (credit)

  // Run the split engine. Empty rule set → 100% to defaultIncome.
  const rules       = await loadActiveSplitRules(db, args.groupId);
  const allocations = allocateSplit(args.amount, rules, defaultIncome);
  if (allocations.length === 0) return; // amount <= 0 guard

  // Resolve account ids for cash + every allocation target in one query.
  const neededCodes = Array.from(new Set([cashCode, ...allocations.map((a) => a.account_code)]));
  const { rows: accts } = await db.query<{ code: string; id: string }>(
    `SELECT account_code AS code, id
     FROM   accounts
     WHERE  group_id = $1 AND is_active = true
       AND  account_code = ANY($2)`,
    [args.groupId, neededCodes],
  );
  const idByCode = new Map(accts.map((a) => [a.code, a.id]));

  const cashId = idByCode.get(cashCode);
  if (!cashId) {
    logger.warn('[mpesa] skipped contribution journal — missing cash account 1001', {
      groupId: args.groupId,
    });
    return;
  }

  // Build credit lines. Any allocation targeting a code that doesn't exist in
  // the chart is redirected to the default income account so the entry still
  // balances. If the default itself is missing, we can't post — bail.
  const creditByAccountId = new Map<string, number>();
  const defaultId = idByCode.get(defaultIncome);
  for (const alloc of allocations) {
    const targetId = idByCode.get(alloc.account_code) ?? defaultId;
    if (!targetId) {
      logger.warn('[mpesa] skipped contribution journal — split target + default both missing', {
        groupId: args.groupId, code: alloc.account_code,
      });
      return;
    }
    creditByAccountId.set(targetId, (creditByAccountId.get(targetId) ?? 0) + alloc.amount_cents);
  }

  const { rows: jeRows } = await db.query<{ id: string }>(
    `INSERT INTO journal_entries
       (group_id, entry_date, reference, description, status, created_by, posted_at, is_test)
     VALUES ($1, CURRENT_DATE, $2, $3, 'posted', NULL, NOW(), $4)
     RETURNING id`,
    [
      args.groupId,
      args.reference,
      `Contribution (M-Pesa) — ${args.contributionId}`,
      IS_SANDBOX,
    ],
  );
  const jeId = jeRows[0].id;

  // Debit cash for the full amount.
  await db.query(
    `INSERT INTO journal_lines (group_id, journal_entry_id, account_id, debit, credit)
     VALUES ($1,$2,$3,$4,0)`,
    [args.groupId, jeId, cashId, args.amount.toFixed(2)],
  );
  // Credit each allocation target.
  for (const [accountId, cents] of creditByAccountId) {
    await db.query(
      `INSERT INTO journal_lines (group_id, journal_entry_id, account_id, debit, credit)
       VALUES ($1,$2,$3,0,$4)`,
      [args.groupId, jeId, accountId, (cents / 100).toFixed(2)],
    );
  }

  await db.query(
    `UPDATE contributions SET journal_entry_id=$1 WHERE id=$2`,
    [jeId, args.contributionId],
  );
}

async function postLoanRepaymentJournal(
  db:   PoolClient,
  args: { groupId: string; repaymentId: string; loanId: string; amount: number; reference: string },
): Promise<void> {
  const cashCode = '1001';
  const loanRecvCode = '1101';   // Loans Receivable (per default chart, mig 032)

  const { rows: accts } = await db.query<{ code: string; id: string }>(
    `SELECT account_code AS code, id
     FROM   accounts
     WHERE  group_id = $1 AND is_active = true
       AND  account_code IN ($2, $3)`,
    [args.groupId, cashCode, loanRecvCode],
  );
  const cashId = accts.find((a) => a.code === cashCode)?.id;
  const recvId = accts.find((a) => a.code === loanRecvCode)?.id;
  if (!cashId || !recvId) {
    logger.warn('[mpesa] skipped loan repayment journal — chart of accounts missing 1001/1101', {
      groupId: args.groupId,
    });
    return;
  }

  const { rows: jeRows } = await db.query<{ id: string }>(
    `INSERT INTO journal_entries
       (group_id, entry_date, reference, description, status, created_by, posted_at, is_test)
     VALUES ($1, CURRENT_DATE, $2, $3, 'posted', NULL, NOW(), $4)
     RETURNING id`,
    [
      args.groupId,
      args.reference,
      `Loan repayment (M-Pesa) — ${args.loanId}`,
      IS_SANDBOX,
    ],
  );
  const jeId = jeRows[0].id;

  await db.query(
    `INSERT INTO journal_lines (group_id, journal_entry_id, account_id, debit, credit)
     VALUES ($1,$2,$3,$4,0), ($1,$2,$5,0,$4)`,
    [args.groupId, jeId, cashId, args.amount.toFixed(2), recvId],
  );

  await db.query(
    `UPDATE loan_repayments SET journal_entry_id=$1 WHERE id=$2`,
    [jeId, args.repaymentId],
  );
}

// ─── C2B Confirmation ─────────────────────────────────────────────────────────

export interface C2BCallbackBody {
  TransactionType:    string;
  TransID:            string;
  TransTime:          string;
  TransAmount:        string;
  BusinessShortCode:  string;
  BillRefNumber:      string;
  InvoiceNumber?:     string;
  OrgAccountBalance?: string;
  ThirdPartyTransID?: string;
  MSISDN:             string;
  FirstName?:         string;
  MiddleName?:        string;
  LastName?:          string;
}

export async function handleC2BConfirmation(
  body: C2BCallbackBody,
  callerIp: string,
  opts?: { skipIpCheck?: boolean },
): Promise<void> {
  if (!opts?.skipIpCheck) assertSafaricomIp(callerIp);

  const phone   = normalizePhone(body.MSISDN);
  const amount  = parseFloat(body.TransAmount);
  const rawBody = JSON.stringify(body);
  const route   = parseBillRefNumber(body.BillRefNumber);

  await withAdminDb(async (db) => {
    // 1. Idempotency — duplicate Safaricom retries return early.
    const { rows: existingPay } = await db.query<{ id: string }>(
      'SELECT id FROM payments WHERE mpesa_receipt_number=$1 LIMIT 1',
      [body.TransID],
    );
    if (existingPay[0]) return;

    // 2. Resolve the group via the parser, with progressive fallback.
    const groupId = await resolveC2BGroupId(db, route, body);

    // 3. If we couldn't even resolve a group, log to unrouted with a NULL
    //    candidate group and bail — there's no group_id to write the
    //    mpesa_transactions row against.
    if (!groupId) {
      if (!isSandboxTestRef(body.BillRefNumber)) {
        await db.query(
          `INSERT INTO mpesa_unrouted
             (receipt, phone, amount, bill_ref, reason, raw_payload, candidate_group_id)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, NULL)
           ON CONFLICT (receipt) DO NOTHING`,
          [
            body.TransID, phone, amount.toFixed(2),
            body.BillRefNumber,
            route.kind === 'unknown' ? 'unknown_prefix' : 'unknown_group',
            rawBody,
          ],
        );
      }
      return;
    }

    // 4. Record the inbound on both the master ledger and legacy payments
    //    table. Both have UNIQUE(mpesa_receipt_number) so retries are safe.
    await db.query(
      `INSERT INTO mpesa_transactions
         (group_id, transaction_type, direction, mpesa_receipt_number,
          phone_number, amount, status, reference, raw_response, completed_at, is_test)
       VALUES ($1,'c2b','inbound',$2,$3,$4,'completed',$5,$6::jsonb,NOW(),$7)
       ON CONFLICT (mpesa_receipt_number) DO NOTHING`,
      [groupId, body.TransID, phone, amount.toFixed(2), body.BillRefNumber, rawBody, IS_SANDBOX],
    );

    await db.query(
      `INSERT INTO payments
         (group_id, amount, payment_method, status, mpesa_receipt_number,
          mpesa_phone, mpesa_raw_callback, payment_date)
       VALUES ($1,$2,'mpesa','completed',$3,$4,$5::jsonb,NOW())
       ON CONFLICT (mpesa_receipt_number) DO NOTHING`,
      [groupId, amount.toFixed(2), body.TransID, phone, rawBody],
    );

    // 5. Auto-fulfilment — route to the matching domain action.
    await fulfilC2B(db, {
      groupId,
      route,
      receipt:  body.TransID,
      amount,
      phone,
      billRef:  body.BillRefNumber,
      rawBody,
    });
  });
}

/**
 * Group resolution strategy for C2B payments:
 *   1. Parser found a group code (`KY1234567`) → look up by `groups.group_code`
 *   2. Parser found an entity id (loan id, invoice number, etc.) → derive the
 *      group via the entity's FK
 *   3. BillRef matches the legacy `UPPER(name)` pattern → resolve by name
 *   4. Phone matches exactly one active member → use their group (only if
 *      they're in exactly one group, per the no-account-ref-is-ambiguous rule)
 */
async function resolveC2BGroupId(
  db:    PoolClient,
  route: RoutingDecision,
  body:  C2BCallbackBody,
): Promise<string | null> {
  // 1. KY group code
  if (route.groupCode) {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM groups WHERE group_code = $1 AND is_active = true LIMIT 1`,
      [route.groupCode],
    );
    if (rows[0]) return rows[0].id;
  }

  // 2. Entity-id-derived group
  if (route.kind === 'invoice' && route.invoiceNumber) {
    const { rows } = await db.query<{ group_id: string }>(
      `SELECT group_id FROM invoices WHERE invoice_number = $1 LIMIT 1`,
      [route.invoiceNumber],
    );
    if (rows[0]) return rows[0].group_id;
  }
  if (route.kind === 'loan_repayment' && route.entityId) {
    const { rows } = await db.query<{ group_id: string }>(
      `SELECT group_id FROM loans WHERE LOWER(id::text) = LOWER($1) LIMIT 1`,
      [route.entityId],
    );
    if (rows[0]) return rows[0].group_id;
  }

  // 3. Legacy fallback — match by group name (case-insensitive)
  if (body.BillRefNumber?.trim()) {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM groups WHERE UPPER(name) = UPPER($1) AND is_active = true LIMIT 1`,
      [body.BillRefNumber],
    );
    if (rows[0]) return rows[0].id;
  }

  // 4. Phone-only fallback (only when member is in exactly one group)
  const phone = normalizePhone(body.MSISDN);
  const { rows: phoneRows } = await db.query<{ group_id: string }>(
    `SELECT gm.group_id
     FROM   group_members gm
     JOIN   members m ON m.id = gm.member_id
     WHERE  m.phone = $1 AND gm.is_active = true AND m.is_active = true`,
    [phone],
  );
  if (phoneRows.length === 1) return phoneRows[0].group_id;

  return null;
}

interface C2BFulfilmentInput {
  groupId:  string;
  route:    RoutingDecision;
  receipt:  string;
  amount:   number;
  phone:    string;
  billRef:  string;
  rawBody:  string;
}

async function fulfilC2B(db: PoolClient, in_: C2BFulfilmentInput): Promise<void> {
  const { route } = in_;

  // Direct invoice payment — flip the invoice to paid
  if (route.kind === 'invoice' && route.invoiceNumber) {
    await db.query(
      `UPDATE invoices
       SET    paid_amount = paid_amount + $1,
              status      = CASE WHEN paid_amount + $1 >= total_amount
                                 THEN 'completed'::payment_status
                                 ELSE status END
       WHERE  invoice_number = $2 AND group_id = $3`,
      [in_.amount.toFixed(2), route.invoiceNumber, in_.groupId],
    );
    return;
  }

  // Contribution-style payments (incl. welfare, share) — auto-create a
  // contribution row keyed to a member resolved by phone.
  if (route.kind === 'contribution' || route.kind === 'welfare' || route.kind === 'share') {
    const memberId = await resolveMemberInGroup(db, in_.phone, in_.groupId);
    if (!memberId) {
      await c2bToUnrouted(db, in_, 'unknown_member');
      return;
    }
    await applyContributionFromC2B(db, { ...in_, memberId });
    return;
  }

  // Loan repayment by paybill — match loan by entityId
  if (route.kind === 'loan_repayment' && route.entityId) {
    // Find the next pending repayment for that loan
    const { rows: rpRows } = await db.query<{ id: string }>(
      `SELECT id
       FROM   loan_repayments
       WHERE  LOWER(loan_id::text) = LOWER($1) AND status = 'pending'
       ORDER  BY installment_number
       LIMIT  1`,
      [route.entityId],
    );
    if (!rpRows[0]) {
      await c2bToUnrouted(db, in_, 'other');
      return;
    }
    // Reuse the same wiring as STK by piggy-backing on applyLoanRepayment
    await applyLoanRepayment(
      db,
      {
        id:                rpRows[0].id,
        group_id:          in_.groupId,
        purpose:           'loan_repayment',
        invoice_id:        null,
        loan_repayment_id: rpRows[0].id,
        account_reference: in_.billRef,
        amount:            in_.amount.toFixed(2),
      },
      { receipt: in_.receipt, amount: in_.amount, phone: in_.phone, rawBody: in_.rawBody },
    );
    return;
  }

  // Subscription / investment / unknown — leave the payment recorded but
  // don't side-effect a domain entity. Treasurer resolves via /mpesa/unrouted.
  await c2bToUnrouted(db, in_, route.kind === 'unknown' ? 'unknown_prefix' : 'other');
}

async function resolveMemberInGroup(
  db:     PoolClient,
  phone:  string,
  groupId: string,
): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT m.id
     FROM   members m
     JOIN   group_members gm ON gm.member_id = m.id
     WHERE  m.phone   = $1
       AND  gm.group_id = $2
       AND  gm.is_active = true
       AND  m.is_active  = true
     LIMIT  1`,
    [phone, groupId],
  );
  return rows[0]?.id ?? null;
}

async function applyContributionFromC2B(
  db:   PoolClient,
  in_:  C2BFulfilmentInput & { memberId: string },
): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO contributions
       (group_id, member_id, amount, contribution_date,
        status, payment_method, mpesa_receipt_number, notes, recorded_by)
     VALUES ($1, $2, $3, CURRENT_DATE, 'completed', 'mpesa', $4, $5, NULL)
     ON CONFLICT (mpesa_receipt_number) DO NOTHING
     RETURNING id`,
    [
      in_.groupId,
      in_.memberId,
      in_.amount.toFixed(2),
      in_.receipt,
      `Auto-routed from PayBill ${in_.billRef}`,
    ],
  );
  const contributionId = rows[0]?.id ?? null;
  if (!contributionId) return;

  await postContributionJournal(db, {
    groupId:        in_.groupId,
    contributionId,
    amount:         in_.amount,
    reference:      in_.receipt,
  });
}

async function c2bToUnrouted(
  db:    PoolClient,
  in_:   C2BFulfilmentInput,
  reason: 'unknown_prefix' | 'unknown_group' | 'unknown_member' | 'ambiguous_member' |
          'no_account_ref' | 'amount_mismatch' | 'other',
): Promise<void> {
  if (isSandboxTestRef(in_.billRef)) return;
  await db.query(
    `INSERT INTO mpesa_unrouted
       (mpesa_transaction_id, receipt, phone, amount, bill_ref,
        reason, raw_payload, candidate_group_id)
     SELECT t.id, $1, $2, $3, $4, $5, $6::jsonb, $7
     FROM   mpesa_transactions t
     WHERE  t.mpesa_receipt_number = $1
     ON CONFLICT (receipt) DO NOTHING`,
    [
      in_.receipt, in_.phone, in_.amount.toFixed(2),
      in_.billRef, reason, in_.rawBody, in_.groupId,
    ],
  );
  logger.warn('[mpesa/c2b] routed to unrouted queue', {
    receipt: in_.receipt,
    reason,
    billRef: in_.billRef,
    phone:   in_.phone,
  });
}

// ─── Callback audit + DLQ replay ──────────────────────────────────────────────

/**
 * Inserts a raw inbound callback into the audit log and returns its id so the
 * route can mark it processed/errored after handling. Callback bodies are the
 * source of truth for the DLQ replay job.
 */
export async function logMpesaCallback(
  callbackType: string,
  callerIp: string,
  rawBody: string,
): Promise<string | null> {
  try {
    return await withAdminDb(async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO mpesa_callbacks (callback_type, caller_ip, body)
         VALUES ($1,$2,$3::jsonb)
         RETURNING id`,
        [callbackType, callerIp, rawBody],
      );
      return rows[0]?.id ?? null;
    });
  } catch {
    return null; // audit logging must never block the 200 ACK to Safaricom
  }
}

export async function markCallbackProcessed(id: string): Promise<void> {
  await withAdminDb((db) =>
    db.query(`UPDATE mpesa_callbacks SET processed=true, processing_error=NULL WHERE id=$1`, [id]),
  ).catch(() => {});
}

export async function markCallbackError(id: string, message: string): Promise<void> {
  await withAdminDb((db) =>
    db.query(`UPDATE mpesa_callbacks SET processing_error=$2 WHERE id=$1`, [id, message.slice(0, 2000)]),
  ).catch(() => {});
}

/**
 * Dead-letter replay for inbound money callbacks. Picks unprocessed
 * stk_push / c2b_confirmation rows older than 2 minutes (giving the inline
 * setImmediate handler time to land) and re-runs the idempotent handler.
 * The original validated caller IP is reused, and the IP check is skipped
 * (these bodies were already authenticated when first received).
 */
export async function replayUnprocessedCallbacks(): Promise<{
  examined: number; replayed: number; failed: number;
}> {
  const rows = await withAdminDb((db) =>
    db.query<{ id: string; callback_type: string; caller_ip: string | null; body: unknown }>(
      `SELECT id, callback_type, caller_ip::text AS caller_ip, body
       FROM   mpesa_callbacks
       WHERE  processed = false
         AND  callback_type IN ('stk_push','c2b_confirmation')
         AND  created_at < NOW() - INTERVAL '2 minutes'
       ORDER  BY created_at ASC
       LIMIT  100`,
    ).then((r) => r.rows),
  );

  let replayed = 0;
  let failed   = 0;
  for (const row of rows) {
    const ip = row.caller_ip ?? '0.0.0.0';
    try {
      if (row.callback_type === 'stk_push') {
        await handleSTKCallback(row.body as StkCallbackBody, ip, { skipIpCheck: true });
      } else {
        await handleC2BConfirmation(row.body as C2BCallbackBody, ip, { skipIpCheck: true });
      }
      await markCallbackProcessed(row.id);
      replayed++;
    } catch (err) {
      await markCallbackError(row.id, String(err));
      failed++;
    }
  }
  return { examined: rows.length, replayed, failed };
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

// ─── Airtime ──────────────────────────────────────────────────────────────────

export interface AirtimeParams {
  phone:        string;
  amount:       number;
  groupId:      string;
  remarks?:     string;
  initiatedBy?: string;
}

export interface AirtimeResult {
  conversationId:           string;
  originatorConversationId: string;
  responseDescription:      string;
}

/**
 * Purchases airtime for a phone, funded from the Airtime Purchase sub-account.
 * Throws NotImplementedError (surfaced as 501) until MPESA_AIRTIME_COMMAND_ID
 * is configured. Records the request in the master ledger as transaction_type
 * 'airtime' so it reports separately from B2C cash.
 */
export async function initiateAirtime(params: AirtimeParams): Promise<AirtimeResult> {
  const phone     = normalizePhone(params.phone);
  const amountStr = toMpesaAmount(params.amount).toFixed(2);

  const res = await _buyAirtime({
    phone,
    amount:  params.amount,
    remarks: params.remarks,
  });

  await withAdminDb((db) =>
    db.query(
      `INSERT INTO mpesa_transactions
         (group_id, transaction_type, direction, phone_number, amount,
          status, description, conversation_id, originator_conversation_id,
          source_account, is_test)
       VALUES ($1,'airtime','outbound',$2,$3,'initiated',$4,$5,$6,$7,$8)
       ON CONFLICT (originator_conversation_id) DO NOTHING`,
      [
        params.groupId, phone, amountStr,
        params.remarks ?? 'Airtime purchase',
        res.conversationId, res.originatorConversationId,
        process.env.MPESA_AIRTIME_SHORTCODE ?? null,
        IS_SANDBOX,
      ],
    ),
  );

  return {
    conversationId:           res.conversationId,
    originatorConversationId: res.originatorConversationId,
    responseDescription:      res.responseDescription,
  };
}

/** Async result/timeout callback for an airtime purchase. */
export async function handleAirtimeResult(
  body: Record<string, unknown>,
  callerIp: string,
  opts?: { skipIpCheck?: boolean },
): Promise<void> {
  if (!opts?.skipIpCheck) assertSafaricomIp(callerIp);

  type RawResult = {
    Result?: {
      ResultCode?: number; ResultDesc?: string;
      OriginatorConversationID?: string; ConversationID?: string;
      ResultParameters?: { ResultParameter?: { Key: string; Value: unknown }[] };
    };
  };
  const r = (body as RawResult).Result;
  if (!r) return;

  const success = r.ResultCode === 0;
  const receipt = r.ResultParameters?.ResultParameter?.find((p) => p.Key === 'TransactionReceipt')?.Value;
  const rawBody = JSON.stringify(body);

  await withAdminDb(async (db) => {
    await db.query(
      `UPDATE mpesa_transactions
       SET status=$1, mpesa_receipt_number=COALESCE(mpesa_receipt_number,$2),
           failure_reason=$3, raw_response=$4::jsonb, completed_at=NOW()
       WHERE originator_conversation_id=$5 OR conversation_id=$6`,
      [
        success ? 'completed' : 'failed',
        receipt != null ? String(receipt) : null,
        success ? null : (r.ResultDesc ?? null),
        rawBody,
        r.OriginatorConversationID ?? '',
        r.ConversationID ?? '',
      ],
    );
    if (!success) {
      await db.query(
        `INSERT INTO failed_payment_logs
           (transaction_type, reference_id, failure_reason, failure_code, raw_data)
         VALUES ('airtime',$1,$2,$3,$4)`,
        [r.OriginatorConversationID ?? '', r.ResultDesc ?? '', String(r.ResultCode ?? ''), rawBody],
      );
    }
  });
}

// ─── Unrouted receipt review (treasurer) ──────────────────────────────────────

export interface UnroutedRow {
  id:                 string;
  receipt:            string;
  phone:              string;
  amount:             string;
  bill_ref:           string | null;
  reason:             string;
  candidate_group_id: string | null;
  resolved:           boolean;
  created_at:         string;
}

/** Lists unresolved receipts awaiting manual allocation for the group. */
export async function listUnrouted(ctx: TenantContext): Promise<UnroutedRow[]> {
  return withDb(ctx, async (db) => {
    const { rows } = await db.query<UnroutedRow>(
      `SELECT id, receipt, phone, amount, bill_ref, reason,
              candidate_group_id, resolved, created_at
       FROM   mpesa_unrouted
       WHERE  resolved = false
       ORDER  BY created_at DESC
       LIMIT  200`,
    );
    return rows;
  });
}

/**
 * Resolves an unrouted receipt. Two actions:
 *   - 'allocate': create a completed contribution for `memberId` in the group,
 *     post the split journal, and mark the receipt resolved.
 *   - 'dismiss': mark resolved with a note and no contribution (e.g. a
 *     mistaken payment handled out-of-band / reversed).
 */
export async function resolveUnrouted(
  ctx: TenantContext,
  id: string,
  action: 'allocate' | 'dismiss',
  opts: { memberId?: string; notes?: string },
): Promise<void> {
  return withTransaction(ctx, async (db) => {
    const { rows } = await db.query<{
      id: string; receipt: string; phone: string; amount: string;
      bill_ref: string | null; resolved: boolean;
    }>(
      `SELECT id, receipt, phone, amount, bill_ref, resolved
       FROM   mpesa_unrouted
       WHERE  id = $1
         AND  (candidate_group_id = $2 OR resolved_to_group_id = $2)
       FOR UPDATE`,
      [id, ctx.groupId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError('Unrouted receipt', id);
    if (row.resolved) return; // already handled

    if (action === 'dismiss') {
      await db.query(
        `UPDATE mpesa_unrouted
         SET resolved=true, resolved_by=$2, resolved_at=NOW(),
             resolved_to_group_id=$3, resolution_notes=$4
         WHERE id=$1`,
        [id, ctx.userId, ctx.groupId, opts.notes ?? 'Dismissed'],
      );
      return;
    }

    // allocate → create contribution + journal
    if (!opts.memberId) throw new NotFoundError('Member', 'required for allocate');

    const amount = parseFloat(row.amount);
    const { rows: contribRows } = await db.query<{ id: string }>(
      `INSERT INTO contributions
         (group_id, member_id, amount, contribution_date,
          status, payment_method, mpesa_receipt_number, notes, recorded_by)
       VALUES ($1,$2,$3,CURRENT_DATE,'completed','mpesa',$4,$5,$6)
       ON CONFLICT (mpesa_receipt_number) DO NOTHING
       RETURNING id`,
      [
        ctx.groupId, opts.memberId, amount.toFixed(2), row.receipt,
        `Manually routed from unrouted receipt (${row.bill_ref ?? 'no ref'})`,
        ctx.userId,
      ],
    );
    const contributionId = contribRows[0]?.id ?? null;
    if (contributionId) {
      await postContributionJournal(db, {
        groupId:        ctx.groupId,
        contributionId,
        amount,
        reference:      row.receipt,
      });
    }

    await db.query(
      `UPDATE mpesa_unrouted
       SET resolved=true, resolved_by=$2, resolved_at=NOW(),
           resolved_to_group_id=$3, resolved_to_contribution=$4,
           resolution_notes=$5
       WHERE id=$1`,
      [id, ctx.userId, ctx.groupId, contributionId, opts.notes ?? 'Allocated to member'],
    );
  });
}

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

    await db.query(
      `INSERT INTO mpesa_b2c_transactions
         (group_id, mpesa_transaction_id, conversation_id,
          originator_conversation_id, phone, amount, command_id,
          occasion, remarks, status, loan_id, disbursed_by, source_account)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'initiated',$10,$11,$12)`,
      [
        params.groupId, txRows[0]?.id ?? null,
        res.conversationId, res.originatorConversationId,
        phone, amountStr, params.commandId,
        params.occasion, remarks,
        params.loanId ?? null, params.disbursedBy ?? null,
        sourceAccount,
      ],
    );
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

export async function handleB2CResult(body: B2CResultBody, callerIp: string): Promise<void> {
  assertSafaricomIp(callerIp);
  const r       = body.Result;
  const rawBody = JSON.stringify(body);

  await withAdminDb(async (db) => {
    // Capture the B2C row early — we need group_id and loan_id later.
    const { rows: b2cRows } = await db.query<{
      id:                   string;
      group_id:             string;
      loan_id:              string | null;
      amount:               string;
      phone:                string;
      disbursed_by:         string | null;
      mpesa_transaction_id: string | null;
    }>(
      `SELECT id, group_id, loan_id, amount, phone, disbursed_by, mpesa_transaction_id
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
      return;
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
    }
  });
}

/** Deterministic Safaricom fee lookup via the seeded tier table (mig 047). */
async function computeB2CCharge(db: PoolClient, amount: number): Promise<number> {
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
async function insertMpesaCharge(
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
async function postStandaloneChargeJournal(
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
       (group_id, entry_date, reference, description, status, created_by, posted_at, is_test)
     VALUES ($1, CURRENT_DATE, $2, $3, 'posted', NULL, NOW(), $4)
     RETURNING id`,
    [args.groupId, args.reference, `M-Pesa ${args.chargeType.toUpperCase()} transaction charge`, IS_SANDBOX],
  );
  const jeId = jeRows[0].id;

  await db.query(
    `INSERT INTO journal_lines (group_id, journal_entry_id, account_id, debit, credit)
     VALUES ($1,$2,$3,$4,0), ($1,$2,$5,0,$4)`,
    [args.groupId, jeId, expenseId, args.amount.toFixed(2), cashId],
  );

  await insertMpesaCharge(db, { ...args, journalEntryId: jeId });
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

  // Combined journal (per locked decision):
  //   DR Loans Receivable (1101)   principal
  //   DR Admin/Charges Expense     Safaricom fee   (only when charge > 0)
  //   CR Cash:M-Pesa (1001)        principal + fee
  const cashCode = '1001';
  const recvCode = '1101';   // Loans Receivable (per default chart, mig 032)

  const { rows: accts } = await db.query<{ code: string; id: string }>(
    `SELECT account_code AS code, id
     FROM   accounts
     WHERE  group_id = $1 AND is_active = true
       AND  account_code = ANY($2)`,
    [args.groupId, [cashCode, recvCode, CHARGE_EXPENSE_CODE]],
  );
  const cashId    = accts.find((a) => a.code === cashCode)?.id;
  const recvId    = accts.find((a) => a.code === recvCode)?.id;
  const expenseId = accts.find((a) => a.code === CHARGE_EXPENSE_CODE)?.id;
  if (!cashId || !recvId) {
    logger.warn('[mpesa] skipped loan disbursement journal — chart of accounts missing 1001/1101', {
      groupId: args.groupId,
    });
    return;
  }

  // Only fold the charge in if we have an expense account to debit it to.
  const postCharge = args.charge > 0 && !!expenseId;
  const cashCredit = postCharge ? args.amount + args.charge : args.amount;

  const { rows: jeRows } = await db.query<{ id: string }>(
    `INSERT INTO journal_entries
       (group_id, entry_date, reference, description, status, created_by, posted_at, is_test)
     VALUES ($1, CURRENT_DATE, $2, $3, 'posted', $4, NOW(), $5)
     RETURNING id`,
    [
      args.groupId,
      args.receipt,
      `Loan disbursement (M-Pesa B2C) — ${args.loanId}`,
      args.disbursedBy,
      IS_SANDBOX,
    ],
  );
  const jeId = jeRows[0].id;

  // DR loans receivable (principal) + CR cash (principal + fee)
  await db.query(
    `INSERT INTO journal_lines (group_id, journal_entry_id, account_id, debit, credit)
     VALUES ($1,$2,$3,$4,0), ($1,$2,$5,0,$6)`,
    [args.groupId, jeId, recvId, args.amount.toFixed(2), cashId, cashCredit.toFixed(2)],
  );
  // DR charges expense (fee)
  if (postCharge) {
    await db.query(
      `INSERT INTO journal_lines (group_id, journal_entry_id, account_id, debit, credit)
       VALUES ($1,$2,$3,$4,0)`,
      [args.groupId, jeId, expenseId, args.charge.toFixed(2)],
    );
  }

  await db.query(
    `UPDATE loans SET journal_entry_id = $1 WHERE id = $2`,
    [jeId, args.loanId],
  );

  // Record the fee for reconciliation against the Charges Paid sub-account.
  if (args.charge > 0 && args.mpesaTransactionId) {
    await insertMpesaCharge(db, {
      groupId:            args.groupId,
      mpesaTransactionId: args.mpesaTransactionId,
      chargeType:         'b2c',
      amount:             args.charge,
      journalEntryId:     postCharge ? jeId : null,
    });
  }
}

// ─── Reversal handling ────────────────────────────────────────────────────────

export async function handleReversalResult(
  body: Record<string, unknown>,
  callerIp: string,
): Promise<void> {
  assertSafaricomIp(callerIp);

  type RawResult = {
    Result?: {
      ResultCode?: number; ResultDesc?: string;
      OriginatorConversationID?: string; ConversationID?: string;
      ResultParameters?: { ResultParameter?: { Key: string; Value: unknown }[] };
    };
  };
  const r = (body as RawResult).Result;
  if (!r) return;

  const origId  = r.OriginatorConversationID ?? '';
  const success = r.ResultCode === 0;
  const get     = (k: string) => r.ResultParameters?.ResultParameter?.find((p) => p.Key === k)?.Value;
  const receipt = get('TransactionReceipt') as string | undefined;

  await withAdminDb(async (db) => {
    await db.query(
      `UPDATE mpesa_reversals
       SET status=$1, reversal_receipt=$2, raw_result=$3, result_received_at=NOW()
       WHERE originator_conversation_id=$4`,
      [success ? 'completed' : 'failed', receipt ?? null, JSON.stringify(body), origId],
    );
    if (success && receipt) {
      await db.query(
        'UPDATE payments SET status=\'reversed\' WHERE mpesa_receipt_number=$1',
        [receipt],
      );
    }
    if (!success) {
      await db.query(
        `INSERT INTO failed_payment_logs
           (transaction_type, reference_id, failure_reason, failure_code, raw_data)
         VALUES ('reversal',$1,$2,$3,$4)`,
        [origId, r.ResultDesc ?? '', String(r.ResultCode ?? ''), JSON.stringify(body)],
      );
    }
  });
}

// ─── B2B result ───────────────────────────────────────────────────────────────

export async function handleB2BResult(
  body: Record<string, unknown>,
  callerIp: string,
): Promise<void> {
  assertSafaricomIp(callerIp);

  type RawResult = {
    Result?: {
      ResultCode?: number; OriginatorConversationID?: string; ConversationID?: string;
      ResultParameters?: { ResultParameter?: { Key: string; Value: unknown }[] };
    };
  };
  const r = (body as RawResult).Result;
  if (!r) return;

  const origId  = r.OriginatorConversationID ?? '';
  const success = r.ResultCode === 0;
  const get     = (k: string) => r.ResultParameters?.ResultParameter?.find((p) => p.Key === k)?.Value;
  const receipt = get('TransactionReceipt') as string | undefined;

  await withAdminDb(async (db) => {
    await db.query(
      `UPDATE mpesa_b2b_transactions
       SET status=$1, mpesa_receipt_number=$2, raw_result=$3, result_received_at=NOW()
       WHERE originator_conversation_id=$4`,
      [success ? 'completed' : 'failed', receipt ?? null, JSON.stringify(body), origId],
    );
    await db.query(
      `UPDATE mpesa_transactions
       SET status=$1, mpesa_receipt_number=$2, raw_response=$3, completed_at=NOW()
       WHERE originator_conversation_id=$4`,
      [success ? 'completed' : 'failed', receipt ?? null, JSON.stringify(body), origId],
    );
  });
}

// ─── Balance result callback ──────────────────────────────────────────────────

export async function handleBalanceResult(
  body: Record<string, unknown>,
  callerIp: string,
): Promise<void> {
  assertSafaricomIp(callerIp);

  type RawResult = {
    Result?: {
      ResultCode?: number; ConversationID?: string; OriginatorConversationID?: string;
    };
  };
  const r = (body as RawResult).Result;
  if (!r) return;

  await withAdminDb(async (db) => {
    await db.query(
      `UPDATE mpesa_transactions
       SET status=$1, raw_response=$2, completed_at=NOW()
       WHERE originator_conversation_id=$3 OR conversation_id=$4`,
      [
        r.ResultCode === 0 ? 'completed' : 'failed',
        JSON.stringify(body),
        r.OriginatorConversationID ?? '',
        r.ConversationID ?? '',
      ],
    );
  });
}

// ─── Transaction Status result ────────────────────────────────────────────────

/**
 * Handles the async Transaction Status query result. Unlike the previous
 * status-only flip, this parses ResultParameters and persists the structured
 * fields Safaricom returns (receipt, amount, party names, reason) so the
 * reconciliation engine can cross-check a queried transaction against our
 * ledger. `skipIpCheck` lets the DLQ replay reuse it.
 */
export async function handleTransactionStatusResult(
  body: Record<string, unknown>,
  callerIp: string,
  opts?: { skipIpCheck?: boolean },
): Promise<void> {
  if (!opts?.skipIpCheck) assertSafaricomIp(callerIp);

  type ResultParam = { Key: string; Value: unknown };
  type RawResult = {
    Result?: {
      ResultCode?: number;
      OriginatorConversationID?: string;
      ConversationID?: string;
      ResultParameters?: { ResultParameter?: ResultParam[] };
    };
  };
  const r = (body as RawResult).Result;
  if (!r) return;

  const params = r.ResultParameters?.ResultParameter ?? [];
  const get = (k: string): string | null => {
    const v = params.find((p) => p.Key === k)?.Value;
    return v == null ? null : String(v);
  };

  const receipt = get('ReceiptNo');
  const amountStr = get('Amount');
  const amount = amountStr != null ? parseFloat(amountStr) : null;

  // Merge a parsed summary alongside the raw body for easy querying later.
  const parsed = {
    receiptNo:         receipt,
    transactionStatus: get('TransactionStatus'),
    amount,
    debitPartyName:    get('DebitPartyName'),
    creditPartyName:   get('CreditPartyName'),
    transactionReason: get('TransactionReason') ?? get('ReasonType'),
    finalisedTime:     get('FinalisedTime'),
  };
  const stored = JSON.stringify({ ...body, _parsed: parsed });

  const success = r.ResultCode === 0;

  await withAdminDb(async (db) => {
    await db.query(
      `UPDATE mpesa_transactions
       SET status               = $1,
           raw_response         = $2::jsonb,
           mpesa_receipt_number = COALESCE(mpesa_receipt_number, $3),
           amount               = CASE WHEN amount = 0 AND $4::numeric IS NOT NULL
                                       THEN $4::numeric ELSE amount END,
           completed_at         = NOW()
       WHERE originator_conversation_id = $5 OR conversation_id = $6`,
      [
        success ? 'completed' : 'failed',
        stored,
        receipt,
        amount != null ? amount.toFixed(2) : null,
        r.OriginatorConversationID ?? '',
        r.ConversationID ?? '',
      ],
    );
  });
}

// ─── Legacy queryBalance shim (used by existing /mpesa/b2c balance_result) ───

export async function queryBalance(): Promise<{ workingAccount: number; utilityAccount: number }> {
  // Balance is returned asynchronously via /api/v1/mpesa/balance?type=result callback
  // This shim initiates the async request only
  const { queryAccountBalance } = await import('./daraja.service');
  await queryAccountBalance();
  return { workingAccount: 0, utilityAccount: 0 };
}

// ─── Reconciliation engine ────────────────────────────────────────────────────

export interface ReconciliationResult {
  reconciliationId:    string;
  transactionsChecked: number;
  mismatchesFound:     number;
  resolvedCount:       number;
}

interface ReconStkRow {
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
       AND  gm.is_active = true AND m.is_active = true
     LIMIT  1`,
    [row.phone, row.group_id],
  );
  const memberId = memRows[0]?.id ?? null;

  if (!memberId) {
    // Surrogate receipt = checkout id (mpesa_unrouted.receipt is NOT NULL/UNIQUE).
    await routeToUnrouted(
      db,
      {
        id: row.id, group_id: row.group_id, purpose: row.purpose, invoice_id: null,
        loan_repayment_id: row.loan_repayment_id, account_reference: row.account_reference,
        amount: row.amount,
      },
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
       (group_id, member_id, amount, contribution_date,
        status, payment_method, mpesa_receipt_number, notes, recorded_by)
     VALUES ($1,$2,$3,CURRENT_DATE,'completed','mpesa',NULL,$4,NULL)
     RETURNING id`,
    [
      row.group_id, memberId, amount.toFixed(2),
      `Reconciled from STK ${row.account_reference} — callback not received; M-Pesa receipt unavailable`,
    ],
  );
  const contributionId = cRows[0].id;

  await postContributionJournal(db, {
    groupId:        row.group_id,
    contributionId,
    amount,
    reference:      row.checkout_request_id,
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
