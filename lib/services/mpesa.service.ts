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
import { ConflictError, NotFoundError } from '@/lib/utils/errors';
import { cacheMpesaStatus, acquireStkLock, releaseStkLock } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { normalizePhone } from '@/lib/utils/phone';
import { toMpesaAmount } from '@/lib/utils/currency';
import { parseBillRefNumber, isSandboxTestRef, type RoutingDecision } from '@/lib/utils/mpesa-bill-ref';
import { normalizeAccountRef, looksLikeMembershipNo, isValidMembershipNo, parseAccountRef, formatMembershipNo, type ProductSuffix } from '@/lib/utils/membership-no';
import { resolveProduct, type PaymentProduct, type ResolvedProduct } from '@/lib/utils/allocation-engine';
import { findOpenRequests, fulfilRequest } from './payment-requests.service';
import { assertActiveMembership } from './membership-guard';
import { postContributionJournal } from './accounting.service';
import { postTemplatedJournal, postLoanDisbursementJournal, postLoanRepaymentJournal } from './posting-templates.service';
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

  // Duplicate-submit guard: an identical prompt (same group, phone, amount,
  // purpose) within 30s is almost certainly a double-tap on the pay button.
  // The receipt UNIQUE constraint already prevents double-POSTING; this
  // prevents the double-PROMPT reaching the member's phone at all.
  const lockKey = `${params.groupId}:${phone}:${amountStr}:${params.purpose ?? 'none'}`;
  if (!(await acquireStkLock(lockKey))) {
    throw new ConflictError(
      'An identical M-Pesa prompt was sent moments ago. Check your phone, or retry in 30 seconds.',
    );
  }

  let res;
  try {
    res = await _stkPush({
      phone,
      amount:           params.amount,
      accountReference: params.accountReference,
      description:      params.description,
    });
  } catch (err) {
    // The prompt never went out — release immediately so the user can retry.
    await releaseStkLock(lockKey);
    throw err;
  }

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

    // 3. Payment spine (accounting / billing side) — channel + initiator
    //    recorded at initiation (payment architecture §7).
    await db.query(
      `INSERT INTO payments
         (group_id, invoice_id, amount, payment_method, status,
          mpesa_checkout_request_id, mpesa_merchant_request_id, mpesa_phone,
          channel, initiated_by)
       VALUES ($1,$2,$3,'mpesa','pending',$4,$5,$6,'stk',$7)
       ON CONFLICT (mpesa_checkout_request_id) DO NOTHING`,
      [
        params.groupId, params.invoiceId ?? null, amountStr,
        res.checkoutRequestId, res.merchantRequestId, phone,
        params.initiatedBy ?? null,
      ],
    );
  });

  // §3.6: STK initiation records a payment request so a member who ignores
  // the prompt and later pays by PayBill with a bare membership number still
  // lands on the intended product (allocation tier A2/A4). Best-effort — a
  // request is an optimization, never a dependency.
  if (params.purpose === 'contribution') {
    await withAdminDb(async (db) => {
      const { rows } = await db.query<{ id: string; member_id: string }>(
        `SELECT gm.id, gm.member_id
         FROM   group_members gm JOIN members m ON m.id = gm.member_id
         WHERE  m.phone = $1 AND gm.group_id = $2
           AND  gm.status = 'active' AND m.is_active = true
         LIMIT  1`,
        [phone, params.groupId],
      );
      if (rows[0]) {
        await db.query(
          `INSERT INTO payment_requests
             (group_id, group_membership_id, member_id, product, amount,
              expires_at, created_by)
           VALUES ($1,$2,$3,'savings',$4, NOW() + INTERVAL '24 hours', $5)`,
          [params.groupId, rows[0].id, rows[0].member_id, amountStr, params.initiatedBy ?? null],
        );
      }
    }).catch((err) => logger.warn('[mpesa] STK payment_request skipped', { err: String(err) }));
  }

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

    // Spine: money landed (first transition only — the status='pending' guard
    // means a replayed callback returns no row and skips this).
    if (paymentId) {
      await logPaymentEvent(db, paymentId, 'received', { checkoutRequestId: cb.CheckoutRequestID });
      await emitOutbox(db, 'payment.received', paymentId, { receipt, amount });
    }

    if (payRows[0]?.invoice_id) {
      await db.query(
        `UPDATE invoices
         SET paid_amount=paid_amount+$1,
             status=CASE WHEN paid_amount+$1>=total_amount THEN 'completed'::payment_status
                         ELSE status END
         WHERE id=$2`,
        [amount.toFixed(2), payRows[0].invoice_id],
      );
      // Invoice-bound payments (registration/subscription/sms_topup) allocate
      // to the billing pipeline right here (§3.5 dispatch table).
      await markSpineAllocated(db, receipt, {
        detail: { product: 'invoice', invoiceId: payRows[0].invoice_id },
      });

      // ACCOUNTING_ARCHITECTURE_AUDIT.md §7: the STK-driven billing path
      // (the one most subscription payments actually go through) previously
      // had no GL trace at all — only the manual billingService.recordPayment
      // path posted. System-posted (created_by NULL): no authenticated
      // officer initiated this, Safaricom's callback did.
      if (stkReq?.group_id) {
        await postTemplatedJournal(
          db, stkReq.group_id, null, 'subscription_payment',
          `Platform subscription payment — invoice ${payRows[0].invoice_id}`,
          { amount },
          { reference: receipt },
        );
      }
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
  // Registry-first (payment architecture §3.7): when the STK request's
  // AccountReference is a membership number (or legacy code) bound to a
  // payment-eligible membership of THIS group, that identifies the member —
  // the prompted phone may legitimately belong to a third party.
  let memberId: string | null = null;

  const hit = await lookupPaymentAccount(db, stkReq.account_reference);
  if (hit
      && (hit.kind === 'membership_no' || hit.kind === 'legacy_code')
      && hit.groupId === stkReq.group_id
      && isPaymentEligible(hit)) {
    memberId = hit.memberId;
  }

  // Fallback: resolve by phone within the group. gm.status is the single
  // membership liveness signal — the legacy is_active boolean is never
  // updated by status transitions and reads true forever (audit C-2).
  if (!memberId) {
    const { rows: memberRows } = await db.query<{ id: string }>(
      `SELECT m.id
       FROM   members m
       JOIN   group_members gm ON gm.member_id = m.id
       WHERE  m.phone   = $1
         AND  gm.group_id = $2
         AND  gm.status = 'active'
         AND  m.is_active  = true
       LIMIT  1`,
      [in_.phone, stkReq.group_id],
    );
    memberId = memberRows[0]?.id ?? null;
  }

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
       (group_id, member_id, group_membership_id, amount, contribution_date,
        status, payment_method, mpesa_receipt_number, notes, recorded_by)
     VALUES ($1, $2,
             (SELECT gm.id FROM group_members gm
              WHERE gm.group_id = $1 AND gm.member_id = $2),
             $3, CURRENT_DATE, 'completed', 'mpesa', $4, $5, NULL)
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

  // Post the matching journal entry (DR cash / CR member savings, split
  // across whatever income accounts the group has configured).
  await postContributionJournal(db, {
    groupId: stkReq.group_id, contributionId, amount: in_.amount,
    entryDate: new Date().toISOString().slice(0, 10), reference: in_.receipt,
    createdBy: null, isTest: IS_SANDBOX,
  });

  // Stamp the back-pointer on the STK request for traceability.
  await db.query(
    `UPDATE mpesa_stk_requests SET contribution_id=$1 WHERE id=$2`,
    [contributionId, stkReq.id],
  );

  // Spine: link the domain row and flip received → allocated (§3.4).
  await db.query(
    `UPDATE contributions
     SET    payment_id = (SELECT id FROM payments WHERE mpesa_receipt_number = $1)
     WHERE  id = $2 AND payment_id IS NULL`,
    [in_.receipt, contributionId],
  );
  await markSpineAllocated(db, in_.receipt, {
    detail: { product: 'savings', contributionId, groupId: stkReq.group_id },
  });

  // Close the request this STK created at initiation (oldest exact match).
  await fulfilMatchingRequest(db, stkReq.group_id, memberId, 'savings', in_.amount, in_.receipt);
}

/**
 * Latch the oldest open exact-amount request for (membership, product) as
 * fulfilled — used by STK fulfilment, where the request was created by the
 * initiation itself. No-op when none matches.
 */
async function fulfilMatchingRequest(
  db:       PoolClient,
  groupId:  string,
  memberId: string,
  product:  PaymentProduct,
  amount:   number,
  receipt:  string,
): Promise<void> {
  await db.query(
    `UPDATE payment_requests pr
     SET    status = 'fulfilled',
            fulfilled_by_payment = (SELECT id FROM payments WHERE mpesa_receipt_number = $5)
     WHERE  pr.id = (
       SELECT pr2.id FROM payment_requests pr2
       JOIN   group_members gm ON gm.id = pr2.group_membership_id
       WHERE  gm.group_id = $1 AND gm.member_id = $2
         AND  pr2.product = $3::payment_product
         AND  pr2.status = 'open'
         AND  pr2.amount = $4
         AND  (pr2.expires_at IS NULL OR pr2.expires_at > NOW())
       ORDER  BY pr2.created_at
       LIMIT  1
     )`,
    [groupId, memberId, product, amount.toFixed(2), receipt],
  );
}

async function applyLoanRepayment(
  db:     PoolClient,
  stkReq: StkRequestRow,
  in_:    FulfilmentInput,
): Promise<void> {
  // Partial semantics (ADR-15): the payment flows through the member's loan
  // waterfall with the pre-bound installment first. An amount short of the
  // installment leaves it 'partially_paid' — never 'completed' short — and
  // any excess cascades to later installments, then savings.
  const { rows } = await db.query<{ member_id: string }>(
    `SELECT member_id FROM loan_repayments WHERE id = $1`,
    [stkReq.loan_repayment_id],
  );
  if (!rows[0]) return;

  await applyLoanWaterfall(db, {
    product: 'loan_repayment', requestId: null, amountVariance: false,
    tier: 'stk_bound', obligationsOnly: false,
    groupId:  stkReq.group_id,
    memberId: rows[0].member_id,
    fulfil: {
      groupId: stkReq.group_id,
      route:   parseBillRefNumber(stkReq.account_reference),
      receipt: in_.receipt,
      amount:  in_.amount,
      phone:   in_.phone,
      billRef: stkReq.account_reference,
      rawBody: in_.rawBody,
    },
    thirdPartyPhone:   null,
    preferRepaymentId: stkReq.loan_repayment_id,
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
            'ambiguous_member' | 'no_account_ref' | 'amount_mismatch' |
            'membership_inactive' | 'bad_account' | 'other';
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
  await markSpineUnrouted(db, in_.receipt, opts.reason);
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
         AND  gm.status = 'active' AND m.is_active = true
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

// ─── Journal posting ──────────────────────────────────────────────────────────
// postContributionJournal / postLoanDisbursementJournal / postLoanRepaymentJournal
// now live in accounting.service.ts, shared with the manual-entry paths in
// contributions.service.ts / loans.service.ts (ACCOUNTING_ARCHITECTURE_AUDIT.md
// §6/§7 — these were two independently-written functions of the same name).

// ─── Payment-identifier registry (payment architecture §3.1) ─────────────────

export interface PaymentAccountHit {
  kind:             string;          // membership_no | legacy_code | invoice | …
  identifier:       string;
  accountStatus:    string;          // payment_accounts.status
  membershipId:     string | null;
  invoiceId:        string | null;
  groupId:          string | null;   // membership's or invoice's group
  memberId:         string | null;
  membershipStatus: string | null;   // group_members.status
  memberActive:     boolean | null;  // members.is_active (platform lock)
  memberPhone:      string | null;
}

/**
 * Single routing lookup: normalise the inbound reference and match it against
 * payment_accounts. Membership numbers and legacy member codes are stored
 * without separators; invoice numbers keep their dashes — so we try both the
 * fully-stripped and the dash-normalised forms.
 */
export async function lookupPaymentAccount(
  db:     PoolClient,
  rawRef: string | null | undefined,
): Promise<PaymentAccountHit | null> {
  const stripped = normalizeAccountRef(rawRef ?? '');
  if (!stripped) return null;
  const dashNorm = (rawRef ?? '')
    .trim().toUpperCase()
    .replace(/[\s_/.]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

  const { rows } = await db.query<{
    kind: string; identifier: string; account_status: string;
    membership_id: string | null; invoice_id: string | null;
    gm_group_id: string | null; member_id: string | null;
    membership_status: string | null; member_active: boolean | null;
    member_phone: string | null; invoice_group_id: string | null;
  }>(
    `SELECT pa.kind, pa.identifier, pa.status AS account_status,
            pa.membership_id, pa.invoice_id,
            gm.group_id  AS gm_group_id,
            gm.member_id,
            gm.status    AS membership_status,
            m.is_active  AS member_active,
            m.phone      AS member_phone,
            i.group_id   AS invoice_group_id
     FROM   payment_accounts pa
     LEFT JOIN group_members gm ON gm.id = pa.membership_id
     LEFT JOIN members       m  ON m.id  = gm.member_id
     LEFT JOIN invoices      i  ON i.id  = pa.invoice_id
     WHERE  pa.identifier IN ($1, $2)
     LIMIT  1`,
    [stripped, dashNorm],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    kind:             r.kind,
    identifier:       r.identifier,
    accountStatus:    r.account_status,
    membershipId:     r.membership_id,
    invoiceId:        r.invoice_id,
    groupId:          r.gm_group_id ?? r.invoice_group_id,
    memberId:         r.member_id,
    membershipStatus: r.membership_status,
    memberActive:     r.member_active,
    memberPhone:      r.member_phone,
  };
}

/** Payment eligibility per the membership state machine (§4.1). */
function isPaymentEligible(hit: PaymentAccountHit): boolean {
  return hit.accountStatus === 'active'
      && hit.membershipStatus === 'active'
      && hit.memberActive === true;
}

// ─── Product allocation (payment architecture §3.5, decision table A1–A9) ───

/**
 * Gathers the allocation-engine inputs for a membership (open requests,
 * member/group defaults) and runs the pure decision table.
 */
async function resolveProductForMembership(
  db:     PoolClient,
  hit:    PaymentAccountHit,
  suffix: ProductSuffix | null,
  amount: number,
): Promise<ResolvedProduct> {
  const [openRequests, defaults] = await Promise.all([
    findOpenRequests(db, hit.membershipId!),
    db.query<{ member_default: PaymentProduct | null; group_default: PaymentProduct }>(
      `SELECT gm.default_product AS member_default, g.default_product AS group_default
       FROM   group_members gm JOIN groups g ON g.id = gm.group_id
       WHERE  gm.id = $1`,
      [hit.membershipId],
    ).then((r) => r.rows[0]),
  ]);

  return resolveProduct({
    suffix,
    openRequests,
    memberDefault: defaults?.member_default ?? null,
    groupDefault:  defaults?.group_default ?? 'savings',
    amount,
  });
}

/** Member has anything collectible on a loan (obligations, §4.1). */
async function hasDueInstallments(
  db: PoolClient, groupId: string, memberId: string,
): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM loan_repayments
     WHERE  group_id = $1 AND member_id = $2
       AND  status IN ('pending','partially_paid','overdue')
     LIMIT  1`,
    [groupId, memberId],
  );
  return !!rows[0];
}

type EligibilityGate = 'allow' | 'force_loan' | 'reject';

/**
 * §4.1 per-state payment behaviour:
 *   active               → all products
 *   suspended / inactive → obligations only: force loan repayment when due
 *                          installments exist, otherwise reject
 *   everything else      → reject (exited/blacklisted/rejected/archived/
 *                          pending_verification, suspended registry rows,
 *                          platform-locked accounts)
 */
async function eligibilityGate(
  db:      PoolClient,
  hit:     PaymentAccountHit,
  product: PaymentProduct,
): Promise<EligibilityGate> {
  if (hit.accountStatus !== 'active' || hit.memberActive !== true) return 'reject';
  if (hit.membershipStatus === 'active') return 'allow';
  if (hit.membershipStatus === 'suspended' || hit.membershipStatus === 'inactive') {
    if (!(await hasDueInstallments(db, hit.groupId!, hit.memberId!))) return 'reject';
    return product === 'loan_repayment' ? 'allow' : 'force_loan';
  }
  return 'reject';
}

interface DispatchArgs {
  product:         PaymentProduct;
  requestId:       string | null;
  amountVariance:  boolean;
  tier:            string;
  /** Suspended/inactive membership — loan waterfall only, no savings leftover. */
  obligationsOnly: boolean;
  groupId:         string;
  memberId:        string;
  fulfil:          C2BFulfilmentInput;
  thirdPartyPhone: string | null;
  /** Loan waterfall: try this installment first (STK pre-bound repayments). */
  preferRepaymentId?: string | null;
}

/**
 * Dispatch to the owning product table — never a blanket insert into
 * contributions (§3.5 dispatch table; audit H-3).
 */
async function dispatchProduct(db: PoolClient, args: DispatchArgs): Promise<void> {
  const { fulfil } = args;

  switch (args.product) {
    case 'savings':
      await applyContributionFromC2B(db, {
        ...fulfil,
        memberId:        args.memberId,
        thirdPartyPhone: args.thirdPartyPhone,
      });
      break;

    case 'welfare':
      await applyWelfareFromC2B(db, args);
      break;

    case 'loan_repayment':
      await applyLoanWaterfall(db, args);
      break;

    case 'share':
      // Shares need a class + unit price — auto-purchasing would be a guess.
      // Treasurer confirms via the unrouted queue (documented Phase 2 limit).
      await c2bToUnrouted(db, fulfil, 'other');
      break;

    default:
      // A9: a product with no registered handler is a configuration error —
      // page loudly, never silently fall back to savings.
      logger.error('[mpesa/allocation] no handler for product (config_error)', {
        product: args.product, receipt: fulfil.receipt, groupId: args.groupId,
      });
      await c2bToUnrouted(db, fulfil, 'other');
      return;
  }

  // Latch the driving request as fulfilled (no-op when none / already closed).
  if (args.requestId) {
    await fulfilRequest(db, args.requestId, await spinePaymentId(db, fulfil.receipt));
  }
}

/** Auto-routed PayBill welfare contribution (§3.5 dispatch; audit H-3). */
async function applyWelfareFromC2B(db: PoolClient, args: DispatchArgs): Promise<void> {
  const { fulfil } = args;
  const note = `Auto-routed from PayBill ${fulfil.billRef} [${args.tier}]`
    + (args.thirdPartyPhone ? ` (third-party payer ${args.thirdPartyPhone})` : '');

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO welfare_pool_contributions
       (group_id, member_id, group_membership_id, amount, contribution_type, payment_method,
        mpesa_receipt_number, period_month, period_year, notes, payment_id)
     VALUES ($1,$2,
             (SELECT gm.id FROM group_members gm
              WHERE gm.group_id = $1 AND gm.member_id = $2),
             $3,'regular','mpesa',$4,
             EXTRACT(MONTH FROM CURRENT_DATE)::smallint,
             EXTRACT(YEAR  FROM CURRENT_DATE)::smallint,
             $5,
             (SELECT id FROM payments WHERE mpesa_receipt_number = $4))
     ON CONFLICT (payment_id) WHERE payment_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [args.groupId, args.memberId, fulfil.amount.toFixed(2), fulfil.receipt, note],
  );
  if (!rows[0]) return; // replay — already recorded

  // Parity note: the manual welfare-recording path posts no journal either;
  // welfare ledger integration is tracked with the welfare module itself.
  await markSpineAllocated(db, fulfil.receipt, {
    isThirdParty: !!args.thirdPartyPhone,
    detail: { product: 'welfare', welfareContributionId: rows[0].id,
              groupId: args.groupId, tier: args.tier,
              ...(args.amountVariance ? { amountVariance: true } : {}) },
  });
}

/**
 * Apply an amount to one installment with partial semantics (ADR-15):
 * running amount_paid; 'completed' ONLY at full satisfaction, else
 * 'partially_paid'. Returns how much was absorbed.
 */
async function applyPartialRepayment(
  db:           PoolClient,
  repaymentId:  string,
  amount:       number,
  receipt:      string,
  stampReceipt: boolean,
): Promise<{ applied: number; loanId: string; principalPortion: number; interestPortion: number } | null> {
  const { rows } = await db.query<{
    id: string; loan_id: string; total_due: string; amount_paid: string;
    principal_component: string; interest_component: string;
  }>(
    `SELECT id, loan_id, total_due, amount_paid, principal_component, interest_component
     FROM   loan_repayments
     WHERE  id = $1 AND status IN ('pending','partially_paid','overdue')
     FOR UPDATE`,
    [repaymentId],
  );
  const row = rows[0];
  if (!row) return null;

  const remaining = parseFloat(row.total_due) - parseFloat(row.amount_paid);
  const applied   = Math.min(amount, remaining);
  if (applied <= 0) return null;

  await db.query(
    `UPDATE loan_repayments
     SET    amount_paid    = amount_paid + $2,
            payment_date   = CURRENT_DATE,
            payment_method = 'mpesa',
            mpesa_receipt_number = CASE WHEN $4 THEN COALESCE(mpesa_receipt_number, $3)
                                        ELSE mpesa_receipt_number END,
            status = CASE WHEN amount_paid + $2 + 0.005 >= total_due
                          THEN 'completed'::contribution_status
                          ELSE 'partially_paid'::contribution_status END
     WHERE  id = $1`,
    [repaymentId, applied.toFixed(2), receipt, stampReceipt],
  );

  // This installment's cash may be a partial amount (waterfall segments can
  // split across installments), so the GL split is proportional to this
  // installment's own scheduled principal:interest ratio — the standard
  // treatment for a partial payment, and the only way the posted entry can
  // balance against the actual cash applied rather than the full schedule.
  const principalComponent = parseFloat(row.principal_component);
  const interestComponent  = parseFloat(row.interest_component);
  const scheduledTotal     = principalComponent + interestComponent;
  const principalPortion   = scheduledTotal > 0 ? round2(applied * (principalComponent / scheduledTotal)) : applied;
  const interestPortion    = round2(applied - principalPortion);

  return { applied, loanId: row.loan_id, principalPortion, interestPortion };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Loan-repayment waterfall (§3.5): the amount flows across the member's due
 * installments oldest-first; any excess falls to the next tier (savings) —
 * never a negative receivable. Obligations-only memberships (§4.1) get no
 * savings leftover: the excess parks unrouted instead.
 */
async function applyLoanWaterfall(db: PoolClient, args: DispatchArgs): Promise<void> {
  const { fulfil } = args;

  // Pre-bound installments (STK) are absorbed first; the rest oldest-first.
  const { rows: due } = await db.query<{ id: string }>(
    `SELECT lr.id
     FROM   loan_repayments lr
     WHERE  lr.group_id = $1 AND lr.member_id = $2
       AND  lr.status IN ('pending','partially_paid','overdue')
     ORDER  BY (lr.id = $3)::int DESC, lr.due_date, lr.installment_number
     FOR UPDATE`,
    [args.groupId, args.memberId,
     args.preferRepaymentId ?? '00000000-0000-0000-0000-000000000000'],
  );

  let remaining = fulfil.amount;
  let stamped   = false; // UNIQUE(mpesa_receipt_number): stamp only the first row
  const segments: { repaymentId: string; loanId: string; applied: number; principalPortion: number; interestPortion: number }[] = [];

  for (const r of due) {
    if (remaining < 0.005) break;
    const seg = await applyPartialRepayment(db, r.id, remaining, fulfil.receipt, !stamped);
    if (seg) {
      segments.push({
        repaymentId: r.id, loanId: seg.loanId, applied: seg.applied,
        principalPortion: seg.principalPortion, interestPortion: seg.interestPortion,
      });
      remaining -= seg.applied;
      stamped = true;
    }
  }

  // Journals per applied segment (DR cash / CR loans receivable + CR interest
  // income, proportional to each installment's own scheduled split).
  for (const seg of segments) {
    await postLoanRepaymentJournal(db, {
      groupId: args.groupId, repaymentId: seg.repaymentId, loanId: seg.loanId,
      principalPortion: seg.principalPortion, interestPortion: seg.interestPortion,
      entryDate: new Date().toISOString().slice(0, 10), reference: fulfil.receipt,
      createdBy: null, isTest: IS_SANDBOX,
    });
  }

  // Link the first installment to the spine (one payment_id per table row).
  if (segments[0]) {
    await db.query(
      `UPDATE loan_repayments
       SET    payment_id = (SELECT id FROM payments WHERE mpesa_receipt_number = $1)
       WHERE  id = $2 AND payment_id IS NULL`,
      [fulfil.receipt, segments[0].repaymentId],
    );
  }

  // Leftover → next tier.
  let leftoverNote: string | null = null;
  if (remaining >= 0.005) {
    if (args.obligationsOnly) {
      // Suspended/inactive: savings not permitted — park the excess.
      leftoverNote = 'excess_unrouted';
      await c2bToUnrouted(db, { ...fulfil, amount: remaining }, 'membership_inactive');
    } else if (segments.length === 0) {
      // Nothing due at all (e.g. suffix -L with no loan): whole amount to savings.
      await applyContributionFromC2B(db, {
        ...fulfil,
        memberId:        args.memberId,
        thirdPartyPhone: args.thirdPartyPhone,
      });
      return;
    } else {
      leftoverNote = 'excess_to_savings';
      const contributionId = await insertSavingsContribution(db, {
        groupId:  args.groupId,
        memberId: args.memberId,
        amount:   remaining,
        receipt:  fulfil.receipt,
        note: `Loan repayment excess from PayBill ${fulfil.billRef}`
          + (args.thirdPartyPhone ? ` (third-party payer ${args.thirdPartyPhone})` : ''),
      });
      if (contributionId === null) leftoverNote = 'excess_duplicate_skipped';
    }
  }

  if (segments.length > 0) {
    await markSpineAllocated(db, fulfil.receipt, {
      isThirdParty: !!args.thirdPartyPhone,
      detail: {
        product: 'loan_repayment', tier: args.tier, segments,
        ...(leftoverNote ? { leftover: remaining.toFixed(2), leftoverNote } : {}),
        ...(args.amountVariance ? { amountVariance: true } : {}),
      },
    });
  }
}

// ─── Payment spine helpers (payment architecture §3.4, §7, §12) ──────────────
// Every state change on a payment appends a payment_events row; money-adjacent
// side effects are announced via the transactional outbox (written in the SAME
// transaction, so an event exists iff the change committed — ADR-17).

async function logPaymentEvent(
  db:        PoolClient,
  paymentId: string,
  event:     'received' | 'validated' | 'allocated' | 'journal_posted' | 'unrouted' |
             'reallocated' | 'reversed' | 'refunded' | 'charged_back' | 'replayed',
  detail?:   Record<string, unknown>,
  actor?:    string | null,
): Promise<void> {
  await db.query(
    `INSERT INTO payment_events (payment_id, event, actor, detail)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [paymentId, event, actor ?? null, JSON.stringify(detail ?? {})],
  );
}

async function emitOutbox(
  db:          PoolClient,
  eventType:   string,
  aggregateId: string,
  payload:     Record<string, unknown>,
): Promise<void> {
  await db.query(
    `INSERT INTO event_outbox (event_type, aggregate_id, payload)
     VALUES ($1, $2, $3::jsonb)`,
    [eventType, aggregateId, JSON.stringify(payload)],
  );
}

/**
 * Emit the member-facing payment receipt event (§8 / audit M-2) for an
 * ALLOCATED payment — the SMS names the group, the Membership Number, the
 * product, and the updated balance, so a multi-group member always knows
 * which membership the money landed on. Product-specific enrichment:
 *
 *   savings        → contributions row + completed-contributions balance
 *   loan repayment → loan_repayments row + the loan's outstanding balance
 *   welfare        → welfare_pool_contributions row + welfare total
 *
 * Non-membership payments (invoices, top-ups) emit with the basic vars and
 * the template engine strips the unresolved placeholders. Must be called
 * AFTER the money transaction committed (emitBusinessEvent does its own DB
 * work and may send inline). Best-effort by design — never throws.
 */
export async function emitPaymentReceiptEvent(
  paymentId: string,
  opts?: { requireAllocated?: boolean },
): Promise<void> {
  try {
    const { emitBusinessEvent } = await import('@/lib/sms/trigger-engine');
    const { SMS_EVENTS }        = await import('@/lib/sms/events');

    const data = await withAdminDb(async (db) => {
      const { rows: [payment] } = await db.query<{
        group_id: string; amount: string; mpesa_phone: string | null;
        mpesa_receipt_number: string | null; allocation_status: string;
      }>(
        `SELECT group_id, amount, mpesa_phone, mpesa_receipt_number, allocation_status
         FROM   payments WHERE id = $1`,
        [paymentId],
      );
      if (!payment) return null;
      // C2B callers only confirm money that actually landed on a membership;
      // STK callers keep the historical always-confirm behaviour (invoice and
      // top-up payments never reach 'allocated' but still deserve a receipt).
      if (opts?.requireAllocated && payment.allocation_status !== 'allocated') return null;

      const { rows: [alloc] } = await db.query<{
        product: string; group_name: string; membership_no: string | null; balance: string;
      }>(
        `SELECT 'savings' AS product, g.name AS group_name, gm.membership_no,
                COALESCE((SELECT SUM(c2.amount) FROM contributions c2
                          WHERE c2.group_membership_id = gm.id AND c2.status = 'completed'), 0)::text AS balance
         FROM   contributions c
         JOIN   group_members gm ON gm.id = c.group_membership_id
         JOIN   groups g         ON g.id  = c.group_id
         WHERE  c.payment_id = $1
         UNION ALL
         SELECT 'loan repayment', g.name, gm.membership_no,
                l.outstanding_balance::text
         FROM   loan_repayments lr
         JOIN   loans l          ON l.id  = lr.loan_id
         JOIN   group_members gm ON gm.id = lr.group_membership_id
         JOIN   groups g         ON g.id  = lr.group_id
         WHERE  lr.payment_id = $1
         UNION ALL
         SELECT 'welfare', g.name, gm.membership_no,
                COALESCE((SELECT SUM(w2.amount) FROM welfare_pool_contributions w2
                          WHERE w2.group_membership_id = gm.id), 0)::text
         FROM   welfare_pool_contributions w
         JOIN   group_members gm ON gm.id = w.group_membership_id
         JOIN   groups g         ON g.id  = w.group_id
         WHERE  w.payment_id = $1
         LIMIT  1`,
        [paymentId],
      );
      return { payment, alloc: alloc ?? null };
    });
    if (!data) return;

    await emitBusinessEvent({
      eventType: SMS_EVENTS.PAYMENT_RECEIVED,
      eventId:   paymentId,
      groupId:   data.payment.group_id,
      payload: {
        amount:  parseFloat(data.payment.amount),
        receipt: data.payment.mpesa_receipt_number ?? 'N/A',
        phone:   data.payment.mpesa_phone,
        ...(data.alloc ? {
          group_name:    data.alloc.group_name,
          membership_no: data.alloc.membership_no ? formatMembershipNo(data.alloc.membership_no) : undefined,
          product:       data.alloc.product,
          balance:       Number(data.alloc.balance).toLocaleString(),
        } : {}),
      },
    });
  } catch (err) {
    logger.warn('[mpesa] receipt event emit skipped', { paymentId, err: String(err) });
  }
}

/** Spine payment id for a receipt (null when no payments row exists). */
async function spinePaymentId(db: PoolClient, receipt: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM payments WHERE mpesa_receipt_number = $1 LIMIT 1`,
    [receipt],
  );
  return rows[0]?.id ?? null;
}

/**
 * Transition the spine to 'allocated' after a successful domain allocation.
 * Idempotent: only rows still in received/unrouted transition.
 */
async function markSpineAllocated(
  db:      PoolClient,
  receipt: string,
  opts?:   { isThirdParty?: boolean; actor?: string | null; detail?: Record<string, unknown> },
): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE payments
     SET    allocation_status = 'allocated',
            is_third_party    = is_third_party OR $2
     WHERE  mpesa_receipt_number = $1
       AND  allocation_status IN ('received','unrouted')
     RETURNING id`,
    [receipt, opts?.isThirdParty ?? false],
  );
  const paymentId = rows[0]?.id;
  if (!paymentId) return;
  await logPaymentEvent(db, paymentId, 'allocated', opts?.detail, opts?.actor);
  await emitOutbox(db, 'payment.allocated', paymentId, {
    receipt, ...(opts?.detail ?? {}),
  });
}

/** Transition the spine to 'unrouted' when auto-allocation could not bind. */
async function markSpineUnrouted(
  db:      PoolClient,
  receipt: string,
  reason:  string,
): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE payments
     SET    allocation_status = 'unrouted'
     WHERE  mpesa_receipt_number = $1 AND allocation_status = 'received'
     RETURNING id`,
    [receipt],
  );
  const paymentId = rows[0]?.id;
  if (!paymentId) return; // surrogate receipts (reconciliation) have no spine row
  await logPaymentEvent(db, paymentId, 'unrouted', { reason });
  await emitOutbox(db, 'payment.unrouted', paymentId, { receipt, reason });
}

// ─── C2B Validation (payment architecture §3.2) ──────────────────────────────

export type C2BValidationVerdict =
  | { accept: true }
  | { accept: false; reason: 'bad_account' | 'unknown_account' | 'membership_inactive' };

/**
 * Pre-payment account validation — Safaricom calls this BEFORE completing a
 * C2B transaction, so a rejection here means the member's money never moves.
 *
 * Deterministic and conservative:
 *  - Membership-number-SHAPED refs are strictly validated (check digit,
 *    registry presence, payment eligibility). A typo'd number is rejected
 *    instead of becoming unrouted-queue toil.
 *  - Everything else (legacy KYT grammar, invoice numbers, group codes)
 *    is accepted and handled by confirmation-side routing, unchanged.
 *  - Any internal error fails OPEN (accept) — we never lose a payment to our
 *    own latency; the unrouted queue remains the backstop.
 */
export async function validateC2BAccount(
  billRef: string | null | undefined,
): Promise<C2BValidationVerdict> {
  try {
    const parsed = parseAccountRef(billRef ?? '');
    if (!looksLikeMembershipNo(parsed.account)) {
      // Not membership-number shaped — legacy/invoice refs flow to
      // confirmation routing as before.
      return { accept: true };
    }
    // A1: an unknown product suffix is malformed — reject, never guess.
    if (parsed.invalidSuffix) {
      return { accept: false, reason: 'bad_account' };
    }
    if (!isValidMembershipNo(parsed.account)) {
      return { accept: false, reason: 'bad_account' };
    }
    return await withAdminDb(async (db) => {
      const hit = await lookupPaymentAccount(db, parsed.account);
      if (!hit) return { accept: false as const, reason: 'unknown_account' as const };
      if (isPaymentEligible(hit)) return { accept: true as const };
      // §4.1 obligations-only: suspended/inactive memberships may still pay
      // down loans — accept when due installments exist (confirmation forces
      // the money to the loan waterfall); otherwise reject before money moves.
      if ((hit.membershipStatus === 'suspended' || hit.membershipStatus === 'inactive')
          && hit.accountStatus === 'active' && hit.memberActive === true
          && await hasDueInstallments(db, hit.groupId!, hit.memberId!)) {
        return { accept: true as const };
      }
      return { accept: false as const, reason: 'membership_inactive' as const };
    });
  } catch (err) {
    logger.error('[mpesa/c2b] validation failed open', { billRef, err: String(err) });
    return { accept: true };
  }
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

    // 2. Registry-first routing (payment architecture §3.3 R1–R4): one
    //    indexed lookup resolves membership numbers and legacy member codes
    //    to a specific membership — the member is identified by the ACCOUNT
    //    NUMBER, never by the paying phone (third parties may pay). A product
    //    suffix (BG102534-W) is split off before the lookup (§3.5 A1/A3).
    const parsed = parseAccountRef(body.BillRefNumber);
    const hit = await lookupPaymentAccount(db, parsed.account);
    if (hit && (hit.kind === 'membership_no' || hit.kind === 'legacy_code') && hit.groupId) {
      await recordC2BInbound(db, hit.groupId, body, phone, amount, rawBody);

      const fulfil: C2BFulfilmentInput = {
        groupId: hit.groupId, route, receipt: body.TransID,
        amount, phone, billRef: body.BillRefNumber, rawBody,
      };

      // A1: an unknown trailing letter is malformed — never "closest guess".
      if (parsed.invalidSuffix) {
        await c2bToUnrouted(db, fulfil, 'bad_account');
        return;
      }

      // §3.5 A2–A8: resolve the product deterministically.
      const resolved = await resolveProductForMembership(
        db, hit, parsed.suffix, amount,
      );

      // §4.1 per-state eligibility: active → all products; suspended/inactive
      // → obligations only. When an obligations-only membership has due
      // installments, the money is FORCED to loan repayment regardless of
      // defaults — a suspended member can always reduce debt, never grow savings.
      const gate = await eligibilityGate(db, hit, resolved.product);
      if (gate === 'reject') {
        await c2bToUnrouted(db, fulfil, 'membership_inactive');
        return;
      }
      const product = gate === 'force_loan' ? 'loan_repayment' : resolved.product;

      await dispatchProduct(db, {
        product,
        requestId:      gate === 'force_loan' ? null : resolved.requestId,
        amountVariance: resolved.amountVariance,
        tier:           gate === 'force_loan' ? 'state_machine' : resolved.tier,
        obligationsOnly: gate === 'force_loan',
        groupId:        hit.groupId,
        memberId:       hit.memberId!,
        fulfil,
        thirdPartyPhone: hit.memberPhone && hit.memberPhone !== phone ? phone : null,
        preferRepaymentId: gate !== 'force_loan' ? resolved.entityId : null,
      });
      return;
    }

    // 3. Legacy grammar fallback — resolve the group via the parser.
    const groupId = await resolveC2BGroupId(db, route, body);

    // 4. If we couldn't even resolve a group, log to unrouted with a NULL
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

    // 5. Record the inbound, then route to the matching domain action.
    await recordC2BInbound(db, groupId, body, phone, amount, rawBody);
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

  // Receipt SMS (§8) — after the money transaction committed. STK-driven
  // payments get theirs from the callback route; direct PayBill deposits
  // land here. No-op unless the payment ended 'allocated'; idempotent per
  // (rule, paymentId) inside the trigger engine, so Safaricom retries
  // cannot send a second receipt.
  const paymentId = await withAdminDb((db) => spinePaymentId(db, body.TransID));
  if (paymentId) await emitPaymentReceiptEvent(paymentId, { requireAllocated: true });
}

/**
 * Records an inbound C2B payment on both the master ledger and the legacy
 * payments table. Both carry UNIQUE(mpesa_receipt_number) so retries are safe.
 */
async function recordC2BInbound(
  db:      PoolClient,
  groupId: string,
  body:    C2BCallbackBody,
  phone:   string,
  amount:  number,
  rawBody: string,
): Promise<void> {
  await db.query(
    `INSERT INTO mpesa_transactions
       (group_id, transaction_type, direction, mpesa_receipt_number,
        phone_number, amount, status, reference, raw_response, completed_at, is_test)
     VALUES ($1,'c2b','inbound',$2,$3,$4,'completed',$5,$6::jsonb,NOW(),$7)
     ON CONFLICT (mpesa_receipt_number) DO NOTHING`,
    [groupId, body.TransID, phone, amount.toFixed(2), body.BillRefNumber, rawBody, IS_SANDBOX],
  );

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO payments
       (group_id, amount, payment_method, status, mpesa_receipt_number,
        mpesa_phone, mpesa_raw_callback, payment_date, channel)
     VALUES ($1,$2,'mpesa','completed',$3,$4,$5::jsonb,NOW(),'paybill')
     ON CONFLICT (mpesa_receipt_number) DO NOTHING
     RETURNING id`,
    [groupId, amount.toFixed(2), body.TransID, phone, rawBody],
  );

  // First arrival appends 'received' + announces on the outbox; a Safaricom
  // retry (conflict → no row) is recorded as 'replayed' instead.
  if (rows[0]) {
    await logPaymentEvent(db, rows[0].id, 'received', { billRef: body.BillRefNumber });
    await emitOutbox(db, 'payment.received', rows[0].id, {
      receipt: body.TransID, amount, groupId,
    });
  } else {
    const existing = await spinePaymentId(db, body.TransID);
    if (existing) await logPaymentEvent(db, existing, 'replayed', { path: 'c2b' });
  }
}

/**
 * Group resolution strategy for C2B payments:
 *   1. Parser found a group code (`KY1234567`) → look up by `groups.group_code`
 *   2. Parser found an entity id (loan id, invoice number, etc.) → derive the
 *      group via the entity's FK
 *   3. Phone matches exactly one active member → use their group (only if
 *      they're in exactly one group, per the no-account-ref-is-ambiguous rule)
 *
 * Group-NAME matching was deliberately removed (audit H-4): groups.name has no
 * uniqueness constraint, so `UPPER(name) = UPPER(billRef) LIMIT 1` could post
 * real money into an arbitrary same-named group. Do not reintroduce it.
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

  // 3. Phone-only fallback (only when member is in exactly one group)
  const phone = normalizePhone(body.MSISDN);
  const { rows: phoneRows } = await db.query<{ group_id: string }>(
    `SELECT gm.group_id
     FROM   group_members gm
     JOIN   members m ON m.id = gm.member_id
     WHERE  m.phone = $1 AND gm.status = 'active' AND m.is_active = true`,
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

  // Contribution-style payments (incl. welfare, share). When the legacy
  // grammar carries a member_code suffix the member is resolved by CODE —
  // never by phone, so third-party payers route correctly (§3.3 R6). Phone
  // resolution survives only for group-only legacy refs.
  if (route.kind === 'contribution' || route.kind === 'welfare' || route.kind === 'share') {
    let memberId: string | null = null;
    let memberPhone: string | null = null;

    if (route.memberCode) {
      const { rows } = await db.query<{ member_id: string; phone: string }>(
        `SELECT gm.member_id, m.phone
         FROM   group_members gm
         JOIN   members m ON m.id = gm.member_id
         WHERE  gm.group_id = $1 AND gm.member_code = $2
           AND  gm.status = 'active' AND m.is_active = true
         LIMIT  1`,
        [in_.groupId, route.memberCode],
      );
      memberId    = rows[0]?.member_id ?? null;
      memberPhone = rows[0]?.phone ?? null;
      // A member code that doesn't match is never "corrected" via phone —
      // that guess is exactly what mis-posts third-party payments.
      if (!memberId) {
        await c2bToUnrouted(db, in_, 'unknown_member');
        return;
      }
    } else {
      memberId = await resolveMemberInGroup(db, in_.phone, in_.groupId);
      if (!memberId) {
        await c2bToUnrouted(db, in_, 'unknown_member');
        return;
      }
    }

    // Product dispatch by legacy ref kind (audit H-3): KYT-WELF money lands
    // in the welfare pool, never mislabelled as savings; shares stay
    // treasurer-mediated (class/price cannot be guessed).
    const thirdPartyPhone = memberPhone && memberPhone !== in_.phone ? in_.phone : null;
    if (route.kind === 'welfare') {
      await applyWelfareFromC2B(db, {
        product: 'welfare', requestId: null, amountVariance: false,
        tier: 'legacy_ref', obligationsOnly: false,
        groupId: in_.groupId, memberId, fulfil: in_, thirdPartyPhone,
      });
    } else if (route.kind === 'share') {
      await c2bToUnrouted(db, in_, 'other');
    } else {
      await applyContributionFromC2B(db, { ...in_, memberId, thirdPartyPhone });
    }
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
       AND  gm.status = 'active'
       AND  m.is_active  = true
     LIMIT  1`,
    [phone, groupId],
  );
  return rows[0]?.id ?? null;
}

/**
 * Insert a completed savings contribution + journal + spine payment_id link.
 * Returns the contribution id, or null on a replay (receipt already recorded).
 * Does NOT flip the spine — callers decide (a loan-waterfall leftover shares
 * one spine transition with its installment segments).
 */
async function insertSavingsContribution(
  db:   PoolClient,
  args: { groupId: string; memberId: string; amount: number; receipt: string; note: string },
): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO contributions
       (group_id, member_id, group_membership_id, amount, contribution_date,
        status, payment_method, mpesa_receipt_number, notes, recorded_by)
     VALUES ($1, $2,
             (SELECT gm.id FROM group_members gm
              WHERE gm.group_id = $1 AND gm.member_id = $2),
             $3, CURRENT_DATE, 'completed', 'mpesa', $4, $5, NULL)
     ON CONFLICT (mpesa_receipt_number) DO NOTHING
     RETURNING id`,
    [args.groupId, args.memberId, args.amount.toFixed(2), args.receipt, args.note],
  );
  const contributionId = rows[0]?.id ?? null;
  if (!contributionId) return null;

  await postContributionJournal(db, {
    groupId: args.groupId, contributionId, amount: args.amount,
    entryDate: new Date().toISOString().slice(0, 10), reference: args.receipt,
    createdBy: null, isTest: IS_SANDBOX,
  });

  await db.query(
    `UPDATE contributions
     SET    payment_id = (SELECT id FROM payments WHERE mpesa_receipt_number = $1)
     WHERE  id = $2 AND payment_id IS NULL`,
    [args.receipt, contributionId],
  );

  return contributionId;
}

async function applyContributionFromC2B(
  db:   PoolClient,
  in_:  C2BFulfilmentInput & { memberId: string; thirdPartyPhone?: string | null },
): Promise<void> {
  // The routing destination is NEVER changed by the payer phone — third
  // parties are flagged, not re-routed.
  const note = `Auto-routed from PayBill ${in_.billRef}`
    + (in_.thirdPartyPhone ? ` (third-party payer ${in_.thirdPartyPhone})` : '');

  const contributionId = await insertSavingsContribution(db, {
    groupId:  in_.groupId,
    memberId: in_.memberId,
    amount:   in_.amount,
    receipt:  in_.receipt,
    note,
  });
  if (!contributionId) return; // replay

  await markSpineAllocated(db, in_.receipt, {
    isThirdParty: !!in_.thirdPartyPhone,
    detail: { product: 'savings', contributionId, groupId: in_.groupId },
  });
}

async function c2bToUnrouted(
  db:    PoolClient,
  in_:   C2BFulfilmentInput,
  reason: 'unknown_prefix' | 'unknown_group' | 'unknown_member' | 'ambiguous_member' |
          'no_account_ref' | 'amount_mismatch' | 'membership_inactive' | 'bad_account' | 'other',
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
  await markSpineUnrouted(db, in_.receipt, reason);
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

    // The allocation target must hold an active membership in the resolving
    // group — treasurers must not be able to park receipts on strangers (audit H-1).
    const { membershipId } = await assertActiveMembership(db, ctx.groupId, opts.memberId);

    const amount = parseFloat(row.amount);
    const { rows: contribRows } = await db.query<{ id: string }>(
      `INSERT INTO contributions
         (group_id, member_id, group_membership_id, amount, contribution_date,
          status, payment_method, mpesa_receipt_number, notes, recorded_by)
       VALUES ($1,$2,$3,$4,CURRENT_DATE,'completed','mpesa',$5,$6,$7)
       ON CONFLICT (mpesa_receipt_number) DO NOTHING
       RETURNING id`,
      [
        ctx.groupId, opts.memberId, membershipId, amount.toFixed(2), row.receipt,
        `Manually routed from unrouted receipt (${row.bill_ref ?? 'no ref'})`,
        ctx.userId,
      ],
    );
    const contributionId = contribRows[0]?.id ?? null;
    if (contributionId) {
      await postContributionJournal(db, {
        groupId: ctx.groupId, contributionId, amount,
        entryDate: new Date().toISOString().slice(0, 10), reference: row.receipt,
        createdBy: null, isTest: IS_SANDBOX,
      });

      // Spine: link + flip unrouted → allocated, attributed to the treasurer.
      await db.query(
        `UPDATE contributions
         SET    payment_id = (SELECT id FROM payments WHERE mpesa_receipt_number = $1)
         WHERE  id = $2 AND payment_id IS NULL`,
        [row.receipt, contributionId],
      );
      await markSpineAllocated(db, row.receipt, {
        actor:  ctx.userId,
        detail: { product: 'savings', contributionId, groupId: ctx.groupId, via: 'unrouted_resolution' },
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

export async function handleB2CResult(body: B2CResultBody, callerIp: string): Promise<void> {
  assertSafaricomIp(callerIp);
  const r       = body.Result;
  const rawBody = JSON.stringify(body);

  await withAdminDb(async (db) => {
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
      }
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
      }
    }
  });
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
       AND  gm.status = 'active' AND m.is_active = true
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
