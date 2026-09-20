/**
 * M-Pesa STK Push: initiation, callback handling, and fulfilment. Split out
 * of mpesa.service.ts (OPTIMIZATION_CLEANUP_AUDIT.md High #9).
 */

import type { PoolClient } from 'pg';
import { withAdminDb } from '@/lib/db';
import { ConflictError } from '@/lib/utils/errors';
import { cacheMpesaStatus, acquireStkLock, releaseStkLock } from '@/lib/redis';
import { logger } from '@/lib/logger';
// normalizePhone (throwing) is still correct for initiateSTK below: that phone
// is the prompt TARGET supplied by our own code, so a bad number must fail
// loudly rather than silently prompt nobody. The safe variant is for the
// inbound callback, where the phone is only recorded.
import { normalizePhone, safeNormalizePhone, UNKNOWN_PAYER_PHONE } from '@/lib/utils/phone';
import { toMpesaAmount } from '@/lib/utils/currency';
import type { PlanType, SubscriptionProduct, BillingCycle } from '@/types/enums';
import { notifyMember } from './notifications.service';
import { billingService } from './billing.service';
import { postContributionJournal, postSystemJournal } from './accounting.service';
import { postTemplatedJournal } from './posting-templates.service';
import { initiateStkPush as _stkPush, assertSafaricomIp } from './daraja.service';
import { lookupPaymentAccount, isPaymentEligible } from './mpesa-payment-accounts.service';
import { IS_SANDBOX, logPaymentEvent, emitOutbox, markSpineAllocated } from './mpesa-spine.service';
import {
  type StkRequestRow,
  type FulfilmentInput,
  fulfilMatchingRequest,
  applyLoanRepayment,
  routeToUnrouted,
} from './mpesa-allocation.service';

// ─── STK Push ────────────────────────────────────────────────────────────────

export interface StkPushParams {
  phone: string;
  amount: number;
  accountReference: string;
  description: string;
  groupId: string;
  invoiceId?: string;
  purpose?: string;
  initiatedBy?: string;
  /** Required when purpose = 'subscription' — the callback activates these. */
  planType?: PlanType;
  product?: SubscriptionProduct;
  /** Defaults to 'monthly' at the callback if omitted (migration 155) — an
   *  older client that never sends this keeps today's behaviour exactly. */
  billingCycle?: BillingCycle;
  /** Required when purpose = 'campaign_donation' — read back at settlement
   *  by applyCampaignDonationFromSTK (migration 184; AccountReference itself
   *  is truncated to 12 chars by Safaricom, so it cannot carry this). */
  campaignId?: string;
  donorName?: string;
  donorMessage?: string;
  isAnonymous?: boolean;
}

export interface StkPushResult {
  checkoutRequestId: string;
  merchantRequestId: string;
  responseCode: string;
  responseDescription: string;
}

export async function initiateSTKPush(params: StkPushParams): Promise<StkPushResult> {
  const phone = normalizePhone(params.phone);
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
      amount: params.amount,
      accountReference: params.accountReference,
      description: params.description,
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
        params.groupId,
        phone,
        amountStr,
        params.accountReference,
        params.description,
        JSON.stringify({ checkoutRequestId: res.checkoutRequestId }),
        IS_SANDBOX,
      ],
    );
    const txId = txRows[0]?.id ?? null;

    // Audit: mpesa_transaction created
    if (txId) {
      await db.query(
        `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, new_values)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          params.groupId,
          params.initiatedBy ?? null,
          'mpesa_transaction.create',
          'mpesa_transaction',
          txId,
          JSON.stringify({
            transaction_type: 'stk_push',
            direction: 'inbound',
            amount: amountStr,
            status: 'pending',
            reference: params.accountReference,
          }),
        ],
      );
    }

    // 2. STK-specific tracking
    const { rows: stkRows } = await db.query<{ id: string }>(
      `INSERT INTO mpesa_stk_requests
         (group_id, mpesa_transaction_id, checkout_request_id, merchant_request_id,
          phone, amount, account_reference, description, purpose,
          status, invoice_id, initiated_by, plan_type, product, billing_cycle,
          campaign_id, donor_name, donor_message, is_anonymous)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (checkout_request_id) DO NOTHING
       RETURNING id`,
      [
        params.groupId,
        txId,
        res.checkoutRequestId,
        res.merchantRequestId,
        phone,
        amountStr,
        params.accountReference.slice(0, 12),
        params.description.slice(0, 20),
        params.purpose ?? null,
        params.invoiceId ?? null,
        params.initiatedBy ?? null,
        params.planType ?? null,
        params.product ?? null,
        params.billingCycle ?? null,
        params.campaignId ?? null,
        params.donorName ?? null,
        params.donorMessage ?? null,
        params.isAnonymous ?? null,
      ],
    );
    const stkId = stkRows[0]?.id ?? null;

    // Audit: stk_request created
    if (stkId) {
      await db.query(
        `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, new_values)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          params.groupId,
          params.initiatedBy ?? null,
          'stk_request.initiate',
          'mpesa_stk_request',
          stkId,
          JSON.stringify({
            checkout_request_id: res.checkoutRequestId,
            amount: amountStr,
            status: 'pending',
            purpose: params.purpose ?? null,
            initiated_by: params.initiatedBy ?? null,
            plan_type: params.planType ?? null,
            product: params.product ?? null,
          }),
        ],
      );
    }

    // 3. Payment spine (accounting / billing side) — channel + initiator
    //    recorded at initiation (payment architecture §7).
    const { rows: payRows } = await db.query<{ id: string }>(
      `INSERT INTO payments
         (group_id, invoice_id, amount, payment_method, status,
          mpesa_checkout_request_id, mpesa_merchant_request_id, mpesa_phone,
          channel, initiated_by)
       VALUES ($1,$2,$3,'mpesa','pending',$4,$5,$6,'stk',$7)
       ON CONFLICT (mpesa_checkout_request_id) DO NOTHING
       RETURNING id`,
      [
        params.groupId,
        params.invoiceId ?? null,
        amountStr,
        res.checkoutRequestId,
        res.merchantRequestId,
        phone,
        params.initiatedBy ?? null,
      ],
    );
    const paymentId = payRows[0]?.id ?? null;

    // Audit: payment created
    if (paymentId) {
      await db.query(
        `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, new_values)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          params.groupId,
          params.initiatedBy ?? null,
          'payment.create',
          'payment',
          paymentId,
          JSON.stringify({
            amount: amountStr,
            payment_method: 'mpesa',
            status: 'pending',
            channel: 'stk',
            checkout_request_id: res.checkoutRequestId,
          }),
        ],
      );
    }
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
    checkoutRequestId: res.checkoutRequestId,
    merchantRequestId: res.merchantRequestId,
    responseCode: res.responseCode,
    responseDescription: res.responseDescription,
  };
}

// ─── STK Callback ────────────────────────────────────────────────────────────

export interface StkCallbackBody {
  Body: {
    stkCallback: {
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResultCode: number;
      ResultDesc: string;
      CallbackMetadata?: {
        Item: { Name: string; Value: unknown }[];
      };
    };
  };
}

export interface StkCallbackResult {
  success: boolean;
  mpesaReceiptNumber: string | null;
  amount: number | null;
  paymentId: string | null;
}

export async function handleSTKCallback(
  body: StkCallbackBody,
  callerIp: string,
  opts?: { skipIpCheck?: boolean },
): Promise<StkCallbackResult> {
  if (!opts?.skipIpCheck) assertSafaricomIp(callerIp);

  const cb = body.Body.stkCallback;
  const rawBody = JSON.stringify(body);

  // ── Failure branch ─────────────────────────────────────────────────────────
  if (cb.ResultCode !== 0) {
    // The STK request row carries everything the fallback SMS needs. The
    // status-guarded UPDATE … RETURNING also acts as a first-transition latch
    // so a duplicate/ replayed failure callback won't re-send the SMS.
    const failed = await withAdminDb(async (db) => {
      const { rows: stkRows } = await db.query<{
        id: string;
        group_id: string;
        phone: string;
        amount: string;
        account_reference: string;
        purpose: string | null;
        status: string;
      }>(
        `UPDATE mpesa_stk_requests
         SET    status='failed', completed_at=NOW(), raw_callback=$2
         WHERE  checkout_request_id=$1 AND status NOT IN ('failed','completed')
         RETURNING id, group_id, phone, amount, account_reference, purpose, status`,
        [cb.CheckoutRequestID, rawBody],
      );
      const stk = stkRows[0] ?? null;

      // Fall back to a plain SELECT for group_id if the row already transitioned
      // (so failed_payment_logs still gets the FK on a duplicate callback).
      const groupId =
        stk?.group_id ??
        (
          await db.query<{ group_id: string | null }>(
            `SELECT group_id FROM mpesa_stk_requests WHERE checkout_request_id=$1 LIMIT 1`,
            [cb.CheckoutRequestID],
          )
        ).rows[0]?.group_id ??
        null;

      // Audit: stk_request transitioned to failed (only on first transition)
      if (stk) {
        await db.query(
          `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            stk.group_id,
            null, // system-triggered via M-Pesa callback
            'stk_request.confirm_failure',
            'mpesa_stk_request',
            stk.id,
            JSON.stringify({ status: 'pending' }),
            JSON.stringify({ status: 'failed', failure_code: String(cb.ResultCode), failure_reason: cb.ResultDesc }),
          ],
        );
      }

      const { rows: payRows } = await db.query<{ id: string; status: string }>(
        `UPDATE payments SET status='failed'
         WHERE mpesa_checkout_request_id=$1 AND status='pending'
         RETURNING id, status`,
        [cb.CheckoutRequestID],
      );

      // Audit: payment transitioned to failed (only on first transition)
      if (payRows[0]) {
        await db.query(
          `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            groupId,
            null, // system-triggered
            'payment.confirm_failure',
            'payment',
            payRows[0].id,
            JSON.stringify({ status: 'pending' }),
            JSON.stringify({ status: 'failed' }),
          ],
        );
      }

      const { rows: txRows } = await db.query<{ id: string; status: string }>(
        `UPDATE mpesa_transactions t
         SET status='failed', failure_reason=$2, raw_response=$3, completed_at=NOW()
         FROM mpesa_stk_requests s
         WHERE s.mpesa_transaction_id=t.id AND s.checkout_request_id=$1
         RETURNING t.id, t.status`,
        [cb.CheckoutRequestID, cb.ResultDesc, rawBody],
      );

      // Audit: mpesa_transaction transitioned to failed (only on first transition)
      if (txRows[0]) {
        await db.query(
          `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            groupId,
            null, // system-triggered
            'mpesa_transaction.confirm_failure',
            'mpesa_transaction',
            txRows[0].id,
            JSON.stringify({ status: 'pending' }),
            JSON.stringify({ status: 'failed', failure_reason: cb.ResultDesc, failure_code: String(cb.ResultCode) }),
          ],
        );
      }

      const { rows: logRows } = await db.query<{ id: string }>(
        `INSERT INTO failed_payment_logs
           (group_id, transaction_type, reference_id, failure_reason, failure_code, raw_data)
         VALUES ($1,'stk_push',$2,$3,$4,$5)
         RETURNING id`,
        [groupId, cb.CheckoutRequestID, cb.ResultDesc, String(cb.ResultCode), rawBody],
      );

      // Audit: failure log recorded
      if (logRows[0]) {
        await db.query(
          `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, new_values)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            groupId,
            null, // system-triggered
            'failed_payment_log.create',
            'failed_payment_log',
            logRows[0].id,
            JSON.stringify({
              transaction_type: 'stk_push',
              failure_code: String(cb.ResultCode),
              failure_reason: cb.ResultDesc,
              reference_id: cb.CheckoutRequestID,
            }),
          ],
        );
      }

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
  // `?? []` rather than the old `CallbackMetadata!` non-null assertion: a
  // success payload without metadata is malformed, but it must not crash the
  // handler before the guard below can classify it.
  const items = cb.CallbackMetadata?.Item ?? [];
  const getItem = (name: string) => items.find((i) => i.Name === name)?.Value;
  const receipt = getItem('MpesaReceiptNumber') as string;
  const amount = getItem('Amount') as number;

  // The receipt is the ONE field this branch genuinely cannot proceed without —
  // it is the idempotency key and the ledger's reference. Treat a
  // ResultCode-0 callback that lacks one as the failure it actually is,
  // rather than inserting a row keyed on `undefined`.
  if (!receipt) {
    logger.error('[mpesa] STK success callback carried no MpesaReceiptNumber', {
      checkoutRequestId: cb.CheckoutRequestID,
    });
    return { success: false, mpesaReceiptNumber: null, amount: null, paymentId: null };
  }

  // Incidental, exactly as in handleC2BConfirmation — the payment is
  // identified by the STK request row and its AccountReference, never by the
  // prompted phone (which may legitimately belong to a third party). This
  // used to be `normalizePhone(...)`, which throws; Safaricom already sends a
  // HASHED MSISDN on this org's C2B confirmations, and that exact throw
  // silently discarded every direct PayBill payment for ~11 weeks (PR #77).
  // STK has not been hit, but it is the same provider, the same shortcode and
  // the same shape — and STK is the primary payment path, so the blast radius
  // would be larger. Degrade the record; never reject the money.
  const phone = safeNormalizePhone(String(getItem('PhoneNumber') ?? '')) ?? UNKNOWN_PAYER_PHONE;

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
              account_reference, amount, plan_type, product, billing_cycle,
              campaign_id, donor_name, donor_message, is_anonymous
       FROM   mpesa_stk_requests
       WHERE  checkout_request_id=$1
       FOR UPDATE`,
      [cb.CheckoutRequestID],
    );
    const stkReq = stkRows[0] ?? null;

    // 3. Mark payments / invoices / m-pesa rows completed.
    const { rows: payRows } = await db.query<{ id: string; invoice_id: string | null; status: string }>(
      `UPDATE payments
       SET    status='completed', mpesa_receipt_number=$1,
              mpesa_raw_callback=$2, payment_date=NOW()
       WHERE  mpesa_checkout_request_id=$3 AND status='pending'
       RETURNING id, invoice_id, status`,
      [receipt, rawBody, cb.CheckoutRequestID],
    );
    const paymentId = payRows[0]?.id ?? null;

    // Audit: payment transitioned to completed (only on first transition)
    if (paymentId) {
      await db.query(
        `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          stkReq?.group_id ?? null,
          null, // system-triggered via M-Pesa callback
          'payment.confirm_success',
          'payment',
          paymentId,
          JSON.stringify({ status: 'pending' }),
          JSON.stringify({
            status: 'completed',
            mpesa_receipt_number: receipt,
            received_at: new Date().toISOString(),
            amount: amount.toFixed(2),
          }),
        ],
      );
    }

    // Spine: money landed (first transition only — the status='pending' guard
    // means a replayed callback returns no row and skips this).
    if (paymentId) {
      await logPaymentEvent(db, paymentId, 'received', { checkoutRequestId: cb.CheckoutRequestID });
      await emitOutbox(db, 'payment.received', paymentId, { receipt, amount });
    }

    if (payRows[0]?.invoice_id) {
      const { rows: invRows } = await db.query<{ id: string; total_amount: string }>(
        `UPDATE invoices
         SET paid_amount=paid_amount+$1,
             status=CASE WHEN paid_amount+$1>=total_amount THEN 'completed'::payment_status
                         ELSE status END
         WHERE id=$2
         RETURNING id, total_amount`,
        [amount.toFixed(2), payRows[0].invoice_id],
      );

      // Audit: invoice paid amount updated
      if (invRows[0]) {
        await db.query(
          `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, new_values)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            stkReq?.group_id ?? null,
            null, // system-triggered
            'invoice.payment_received',
            'invoice',
            invRows[0].id,
            JSON.stringify({
              paid_amount_delta: amount.toFixed(2),
              payment_receipt: receipt,
              via_mpesa_receipt: receipt,
            }),
          ],
        );
      }

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
          db,
          stkReq.group_id,
          null,
          'subscription_payment',
          `Platform subscription payment — invoice ${payRows[0].invoice_id}`,
          { amount },
          { reference: receipt },
        );
      }
    }

    const { rows: stkUpdateRows } = await db.query<{ id: string; status: string }>(
      `UPDATE mpesa_stk_requests
       SET    status='completed', raw_callback=$1, completed_at=NOW()
       WHERE  checkout_request_id=$2 AND status='pending'
       RETURNING id, status`,
      [rawBody, cb.CheckoutRequestID],
    );

    // Audit: stk_request transitioned to completed (only on first transition)
    if (stkUpdateRows[0]) {
      await db.query(
        `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          stkReq?.group_id ?? null,
          null, // system-triggered
          'stk_request.confirm_success',
          'mpesa_stk_request',
          stkUpdateRows[0].id,
          JSON.stringify({ status: 'pending' }),
          JSON.stringify({
            status: 'completed',
            mpesa_receipt_number: receipt,
            completed_at: new Date().toISOString(),
          }),
        ],
      );
    }

    const { rows: txUpdateRows } = await db.query<{ id: string; status: string }>(
      `UPDATE mpesa_transactions t
       SET    status='completed', mpesa_receipt_number=$1,
              raw_response=$2, completed_at=NOW(), phone_number=$3,
              is_test=$5
       FROM   mpesa_stk_requests s
       WHERE  s.mpesa_transaction_id=t.id AND s.checkout_request_id=$4
       RETURNING t.id, t.status`,
      [receipt, rawBody, phone, cb.CheckoutRequestID, IS_SANDBOX],
    );

    // Audit: mpesa_transaction transitioned to completed
    if (txUpdateRows[0]) {
      await db.query(
        `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          stkReq?.group_id ?? null,
          null, // system-triggered
          'mpesa_transaction.confirm_success',
          'mpesa_transaction',
          txUpdateRows[0].id,
          JSON.stringify({ status: 'pending' }),
          JSON.stringify({
            status: 'completed',
            mpesa_receipt_number: receipt,
            phone_number: phone !== UNKNOWN_PAYER_PHONE ? '[redacted]' : phone,
          }),
        ],
      );
    }

    // 4. Domain-level fulfilment (the new wiring).
    if (stkReq) {
      await fulfilStkCallback(db, stkReq, { receipt, amount, phone, rawBody });
    }

    return { paymentId, alreadyDone: false };
  });

  await cacheMpesaStatus(cb.CheckoutRequestID, 'completed');
  return {
    success: true,
    mpesaReceiptNumber: receipt,
    amount,
    paymentId: result.paymentId,
  };
}

// ─── STK fulfilment helpers ───────────────────────────────────────────────────

/**
 * Routes a completed STK Push to its domain side-effect based on the
 * request's `purpose` / `loan_repayment_id`. Idempotent — every INSERT
 * uses `ON CONFLICT DO NOTHING` keyed on `mpesa_receipt_number`.
 */
async function fulfilStkCallback(db: PoolClient, stkReq: StkRequestRow, in_: FulfilmentInput): Promise<void> {
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

  // Subscription — activate the plan that was actually paid for.
  if (stkReq.purpose === 'subscription') {
    await activateSubscriptionFromSTK(db, stkReq, in_);
    return;
  }

  // Changi$ha donation — the payer is a member of the public, not a group
  // member, so there is no member-matching step (contrast applyContributionFromSTK).
  if (stkReq.purpose === 'campaign_donation') {
    await applyCampaignDonationFromSTK(db, stkReq, in_);
    return;
  }

  // sms_topup is fulfilled by processFulfillment() in the callback route
  // rather than here, and `registration` has no domain action (group
  // verification is email/OTP-based, not paid). Both are deliberate; see
  // app/api/v1/mpesa/callback/route.ts.
}

/**
 * Turn a confirmed subscription payment into an active plan.
 *
 * Runs inside the callback's own transaction, so the plan flips in the same
 * commit that marks the payment completed. Failures here must not abort that
 * commit — the money is real and the payment row must still be recorded — so
 * anything that makes activation impossible (missing plan/product on the
 * request, underpayment, a negotiated tier sold through self-serve) is logged
 * and swallowed, leaving the group on its current plan for ops to resolve.
 */
async function activateSubscriptionFromSTK(db: PoolClient, stkReq: StkRequestRow, in_: FulfilmentInput): Promise<void> {
  // Pre-138 rows, or a client that skipped the fields, carry no plan to
  // activate. Nothing sane to guess here: the account reference is the
  // constant 'SUBSCRIPT' and matching on amount alone would pick a plan by
  // price collision across two products.
  if (!stkReq.plan_type || !stkReq.product) {
    logger.error('[mpesa] subscription payment with no plan recorded — not activating', {
      stkRequestId: stkReq.id,
      groupId: stkReq.group_id,
      receipt: in_.receipt,
    });

    // Audit: subscription activation skipped due to missing plan metadata
    await db.query(
      `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, new_values)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        stkReq.group_id,
        null, // system-triggered
        'subscription.activate_skipped_missing_plan',
        'mpesa_stk_request',
        stkReq.id,
        JSON.stringify({
          reason: 'missing_plan_metadata',
          mpesa_receipt: in_.receipt,
        }),
      ],
    );
    return;
  }

  const { rows: pay } = await db.query<{ id: string }>(
    `SELECT id FROM payments WHERE mpesa_receipt_number = $1 LIMIT 1`,
    [in_.receipt],
  );
  if (!pay[0]) {
    logger.error('[mpesa] subscription payment row not found — not activating', {
      stkRequestId: stkReq.id,
      receipt: in_.receipt,
    });

    // Audit: subscription activation skipped due to missing payment record
    await db.query(
      `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, new_values)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        stkReq.group_id,
        null, // system-triggered
        'subscription.activate_skipped_payment_not_found',
        'mpesa_stk_request',
        stkReq.id,
        JSON.stringify({
          reason: 'payment_row_not_found',
          mpesa_receipt: in_.receipt,
        }),
      ],
    );
    return;
  }

  try {
    const sub = await billingService.activateSubscriptionForPayment(db, {
      groupId: stkReq.group_id,
      planType: stkReq.plan_type as PlanType,
      product: stkReq.product as SubscriptionProduct,
      paymentId: pay[0].id,
      amountPaid: in_.amount,
      // Undefined (not null) when the column is NULL, so the function's own
      // `?? 'monthly'` default applies — same behaviour a pre-155 row always had.
      billingCycle: (stkReq.billing_cycle as BillingCycle | null) ?? undefined,
    });
    if (sub) {
      logger.info('[mpesa] subscription activated', {
        groupId: stkReq.group_id,
        product: stkReq.product,
        planType: stkReq.plan_type,
        paymentId: pay[0].id,
      });

      // Audit: subscription successfully activated
      await db.query(
        `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, new_values)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          stkReq.group_id,
          null, // system-triggered via M-Pesa callback
          'subscription.activate_from_stk',
          'subscription',
          typeof sub === 'object' && 'id' in sub ? ((sub as { id?: string }).id ?? stkReq.id) : stkReq.id,
          JSON.stringify({
            plan_type: stkReq.plan_type,
            product: stkReq.product,
            billing_cycle: stkReq.billing_cycle ?? 'monthly',
            payment_id: pay[0].id,
            mpesa_receipt: in_.receipt,
            amount_paid: in_.amount.toFixed(2),
          }),
        ],
      );
    }
  } catch (err) {
    // Underpayment or a non-self-serve tier. Deliberately not rethrown: the
    // payment is legitimate and must stay recorded, and Safaricom must still
    // get its 200.
    logger.error('[mpesa] subscription payment could not be activated', {
      groupId: stkReq.group_id,
      product: stkReq.product,
      planType: stkReq.plan_type,
      paymentId: pay[0].id,
      amount: in_.amount,
      err: String(err),
    });

    // Audit: subscription activation failed with error
    await db.query(
      `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, new_values)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        stkReq.group_id,
        null, // system-triggered
        'subscription.activate_failed',
        'mpesa_stk_request',
        stkReq.id,
        JSON.stringify({
          plan_type: stkReq.plan_type,
          product: stkReq.product,
          reason: 'activation_error',
          error_msg: String(err),
          mpesa_receipt: in_.receipt,
          payment_id: pay[0]?.id,
        }),
      ],
    );
  }
}

async function applyContributionFromSTK(db: PoolClient, stkReq: StkRequestRow, in_: FulfilmentInput): Promise<void> {
  // Registry-first (payment architecture §3.7): when the STK request's
  // AccountReference is a membership number (or legacy code) bound to a
  // payment-eligible membership of THIS group, that identifies the member —
  // the prompted phone may legitimately belong to a third party.
  let memberId: string | null = null;

  const hit = await lookupPaymentAccount(db, stkReq.account_reference);
  if (
    hit &&
    (hit.kind === 'membership_no' || hit.kind === 'legacy_code') &&
    hit.groupId === stkReq.group_id &&
    isPaymentEligible(hit)
  ) {
    memberId = hit.memberId;
  }

  // Fallback: resolve by phone within the group. gm.status is the single
  // membership liveness signal — the legacy is_active boolean is never
  // updated by status transitions and reads true forever (audit C-2).
  //
  // Skipped entirely when the payer phone is unknown (hashed/absent MSISDN):
  // matching the sentinel against `members.phone` can only ever be wrong —
  // either it finds nothing, or a member has literally stored 'unknown' and
  // would be credited for someone else's payment. Falling through to the
  // unrouted path below is the correct outcome.
  if (!memberId && in_.phone !== UNKNOWN_PAYER_PHONE) {
    const { rows: memberRows } = await db.query<{ id: string }>(
      `SELECT m.id
       FROM   members m
       JOIN   group_members gm ON gm.member_id = m.id
       WHERE  m.phone = $1
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

  // Audit: contribution created from STK payment
  await db.query(
    `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, new_values)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      stkReq.group_id,
      null, // system-triggered via M-Pesa callback
      'contribution.allocate_from_stk',
      'contribution',
      contributionId,
      JSON.stringify({
        member_id: memberId,
        amount: in_.amount.toFixed(2),
        status: 'completed',
        payment_method: 'mpesa',
        mpesa_receipt_number: in_.receipt,
        auto_routed_from_account_ref: stkReq.account_reference,
      }),
    ],
  );

  // Post the matching journal entry (DR cash / CR member savings, split
  // across whatever income accounts the group has configured).
  await postContributionJournal(db, {
    groupId: stkReq.group_id,
    contributionId,
    amount: in_.amount,
    entryDate: new Date().toISOString().slice(0, 10),
    reference: in_.receipt,
    createdBy: null,
    isTest: IS_SANDBOX,
  });

  // Stamp the back-pointer on the STK request for traceability.
  const { rows: stkUpdateRows } = await db.query<{ id: string }>(
    `UPDATE mpesa_stk_requests SET contribution_id=$1 WHERE id=$2
     RETURNING id`,
    [contributionId, stkReq.id],
  );

  // Audit: stk_request linked to contribution
  if (stkUpdateRows[0]) {
    await db.query(
      `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, new_values)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        stkReq.group_id,
        null, // system-triggered
        'stk_request.link_contribution',
        'mpesa_stk_request',
        stkReq.id,
        JSON.stringify({ contribution_id: contributionId }),
      ],
    );
  }

  // Spine: link the domain row and flip received → allocated (§3.4).
  const { rows: contribLinkRows } = await db.query<{ id: string }>(
    `UPDATE contributions
     SET    payment_id = (SELECT id FROM payments WHERE mpesa_receipt_number = $1)
     WHERE  id = $2 AND payment_id IS NULL
     RETURNING id`,
    [in_.receipt, contributionId],
  );

  // Audit: contribution linked to payment
  if (contribLinkRows[0]) {
    await db.query(
      `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, new_values)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        stkReq.group_id,
        null, // system-triggered
        'contribution.link_payment',
        'contribution',
        contributionId,
        JSON.stringify({ mpesa_receipt: in_.receipt }),
      ],
    );
  }

  await markSpineAllocated(db, in_.receipt, {
    detail: { product: 'savings', contributionId, groupId: stkReq.group_id },
  });

  // Close the request this STK created at initiation (oldest exact match).
  await fulfilMatchingRequest(db, stkReq.group_id, memberId, 'savings', in_.amount, in_.receipt);
}

// ─── STK failure → PayBill fallback nudge ─────────────────────────────────────

interface FailedStkRow {
  group_id: string;
  phone: string;
  amount: string;
  account_reference: string;
  purpose: string | null;
}

/**
 * Human-readable reason for the common Daraja STK result codes. Drives the
 * fallback SMS copy. We deliberately do NOT auto-retry the STK — that
 * surprises members and risks duplicate charges; we point them to PayBill.
 */
function stkFailureReason(code: number): string {
  switch (code) {
    case 1032:
      return 'was cancelled';
    case 1037:
      return 'timed out with no response';
    case 1:
      return 'failed due to insufficient M-Pesa balance';
    case 2001:
      return 'failed due to an incorrect M-Pesa PIN';
    default:
      return 'could not be completed';
  }
}

/**
 * Settles a Changi$ha donation. Unlike applyContributionFromSTK, there is no
 * member to match — the payer is a member of the public, so this creates the
 * campaign_donations row directly rather than looking one up. donor_name/
 * donor_message/is_anonymous ride on the STK request row itself
 * (stkReq.campaign_id etc., migration 184) rather than a pre-created pending
 * row, because AccountReference — the only thing that would otherwise
 * correlate a callback back to a specific donation — is truncated to 12
 * characters by Safaricom before it ever reaches us (daraja.service.ts).
 *
 * Idempotent the same way as applyContributionFromSTK: ON CONFLICT on
 * campaign_donations' unique mpesa_receipt_number index makes a duplicate
 * callback a no-op.
 */
async function applyCampaignDonationFromSTK(
  db: PoolClient,
  stkReq: StkRequestRow,
  in_: FulfilmentInput,
): Promise<void> {
  if (!stkReq.campaign_id) {
    logger.error('[mpesa] campaign_donation callback with no campaign_id on its STK request', {
      stkRequestId: stkReq.id,
    });
    return;
  }

  const { rows: donationRows } = await db.query<{ id: string }>(
    `INSERT INTO campaign_donations
       (campaign_id, group_id, donor_name, donor_phone, amount, message, is_anonymous, mpesa_receipt_number, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'completed')
     ON CONFLICT (mpesa_receipt_number) DO NOTHING
     RETURNING id`,
    [
      stkReq.campaign_id,
      stkReq.group_id,
      stkReq.donor_name,
      in_.phone,
      in_.amount.toFixed(2),
      stkReq.donor_message,
      stkReq.is_anonymous ?? false,
      in_.receipt,
    ],
  );
  const donationId = donationRows[0]?.id ?? null;
  if (!donationId) return; // duplicate callback — nothing more to do

  const { rows: campaignRows } = await db.query<{ title: string }>(
    `UPDATE campaigns
     SET    amount_raised = amount_raised + $2, updated_at = NOW()
     WHERE  id = $1
     RETURNING title`,
    [stkReq.campaign_id, in_.amount.toFixed(2)],
  );
  const campaignTitle = campaignRows[0]?.title ?? 'campaign';

  const journalEntryId = await postSystemJournal(
    db,
    stkReq.group_id,
    null,
    `Changi$ha donation — ${campaignTitle}`,
    [
      { accountCode: '1001', debit: in_.amount },
      { accountCode: '4006', credit: in_.amount },
    ],
    { reference: in_.receipt, isTest: IS_SANDBOX },
  );
  if (journalEntryId) {
    await db.query(`UPDATE campaign_donations SET journal_entry_id = $1 WHERE id = $2`, [journalEntryId, donationId]);
  }

  // Audit: donation settled from STK payment
  await db.query(
    `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, new_values)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      stkReq.group_id,
      null, // system-triggered via M-Pesa callback
      'campaign_donation.settle',
      'campaign_donation',
      donationId,
      JSON.stringify({
        amount: in_.amount.toFixed(2),
        mpesa_receipt_number: in_.receipt,
        campaign_id: stkReq.campaign_id,
      }),
    ],
  );
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
    db
      .query<{ id: string }>(
        `SELECT m.id
       FROM   members m
       JOIN   group_members gm ON gm.member_id = m.id
       WHERE  m.phone = $1 AND gm.group_id = $2
         AND  gm.status = 'active' AND m.is_active = true
       LIMIT  1`,
        [stk.phone, stk.group_id],
      )
      .then((r) => r.rows[0] ?? null),
  );
  if (!member) return; // can't attribute the nudge — skip

  // Single home — see lib/sms/templates.ts. Previously duplicated here, in
  // contributions.service.ts and in lib/jobs/handlers.ts.
  const { platformPaybill } = await import('@/lib/sms/templates');
  const paybill = platformPaybill();
  const amount = Math.round(parseFloat(stk.amount));
  // No brand prefix: the message already arrives from the registered sender
  // ID "KITABU YETU" (lib/env.ts TEXTSMS_SENDER_ID), so repeating it here just
  // spends characters on a fallback message that is already close to a second
  // segment once a long account reference is substituted.
  const body =
    `Your M-Pesa payment of KES ${amount} ${stkFailureReason(resultCode)}. ` +
    `To complete it, pay via PayBill ${paybill}, Account ${stk.account_reference}. ` +
    `Reply HELP for support.`;

  // Log the fallback notification send attempt
  await withAdminDb((db) =>
    db.query(
      `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, new_values)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        stk.group_id,
        null, // system-triggered
        'notification.send_stk_fallback',
        'notification',
        null, // notification doesn't have a persistent ID at this point
        JSON.stringify({
          member_id: member.id,
          phone: '[redacted]',
          purpose: stk.purpose,
          stk_failure_code: resultCode,
          amount: amount,
          fallback_paybill: paybill,
          fallback_account_ref: stk.account_reference,
        }),
      ],
    ),
  );

  await notifyMember({
    groupId: stk.group_id,
    memberId: member.id,
    phone: stk.phone,
    body,
    referenceType: 'stk_fallback',
    // Phase 2b (docs/messaging/UNIFIED_MESSAGING_ARCHITECTURE.md Decision B):
    // bundled allowance now exists, so this real send-path bills.
    billingMode: 'billed',
  });
}
