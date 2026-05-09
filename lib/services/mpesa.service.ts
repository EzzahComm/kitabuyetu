/**
 * M-Pesa orchestration layer.
 *
 * Wraps daraja.service.ts (raw Daraja API calls) and handles:
 *  - Dual-writes to dedicated M-Pesa tables AND the legacy payments table.
 *  - Idempotency — MpesaReceiptNumber is the primary idempotency key.
 *  - Redis status cache for fast frontend polling.
 *  - IP verification delegated to daraja.service.assertSafaricomIp.
 */

import { withAdminDb } from '@/lib/db';
import { cacheMpesaStatus } from '@/lib/redis';
import { normalizePhone } from '@/lib/utils/phone';
import { toMpesaAmount } from '@/lib/utils/currency';
import {
  initiateStkPush    as _stkPush,
  initiateB2C        as _b2c,
  registerC2BUrls    as _registerC2B,
  queryStkStatus     as _stkQuery,
  assertSafaricomIp,
  type B2CInput,
  type C2BApiVersion,
} from './daraja.service';

// Re-export helpers used directly by routes
export { assertSafaricomIp };

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
          status, reference, description, raw_request)
       VALUES ($1,'stk_push','inbound',$2,$3,'pending',$4,$5,$6)
       RETURNING id`,
      [
        params.groupId, phone, amountStr,
        params.accountReference, params.description,
        JSON.stringify({ checkoutRequestId: res.checkoutRequestId }),
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

export async function handleSTKCallback(
  body: StkCallbackBody,
  callerIp: string,
): Promise<StkCallbackResult> {
  assertSafaricomIp(callerIp);

  const cb = body.Body.stkCallback;

  if (cb.ResultCode !== 0) {
    await withAdminDb(async (db) => {
      await db.query(
        `UPDATE payments SET status='failed'
         WHERE mpesa_checkout_request_id=$1 AND status='pending'`,
        [cb.CheckoutRequestID],
      );
      await db.query(
        `UPDATE mpesa_stk_requests SET status='failed', completed_at=NOW()
         WHERE checkout_request_id=$1`,
        [cb.CheckoutRequestID],
      );
      await db.query(
        `UPDATE mpesa_transactions t
         SET status='failed', failure_reason=$2, raw_response=$3, completed_at=NOW()
         FROM mpesa_stk_requests s
         WHERE s.mpesa_transaction_id=t.id AND s.checkout_request_id=$1`,
        [cb.CheckoutRequestID, cb.ResultDesc, JSON.stringify(body)],
      );
      await db.query(
        `INSERT INTO failed_payment_logs
           (transaction_type, reference_id, failure_reason, raw_data)
         VALUES ('stk_push',$1,$2,$3)`,
        [cb.CheckoutRequestID, cb.ResultDesc, JSON.stringify(body)],
      );
    });
    await cacheMpesaStatus(cb.CheckoutRequestID, 'failed');
    return { success: false, mpesaReceiptNumber: null, amount: null, paymentId: null };
  }

  const items   = cb.CallbackMetadata!.Item;
  const getItem = (name: string) => items.find((i) => i.Name === name)?.Value;
  const receipt = getItem('MpesaReceiptNumber') as string;
  const amount  = getItem('Amount') as number;
  const phone   = normalizePhone(String(getItem('PhoneNumber') ?? ''));

  // Idempotency
  const existing = await withAdminDb(async (db) => {
    const { rows } = await db.query<{ id: string; status: string }>(
      `SELECT id, status FROM payments
       WHERE mpesa_receipt_number=$1 OR mpesa_checkout_request_id=$2
       LIMIT 1`,
      [receipt, cb.CheckoutRequestID],
    );
    return rows[0] ?? null;
  });

  if (existing?.status === 'completed') {
    await cacheMpesaStatus(cb.CheckoutRequestID, 'completed');
    return { success: true, mpesaReceiptNumber: receipt, amount, paymentId: existing.id };
  }

  const paymentId = await withAdminDb(async (db) => {
    const { rows } = await db.query<{ id: string; invoice_id: string | null }>(
      `UPDATE payments
       SET status='completed', mpesa_receipt_number=$1,
           mpesa_raw_callback=$2, payment_date=NOW()
       WHERE mpesa_checkout_request_id=$3 AND status='pending'
       RETURNING id, invoice_id`,
      [receipt, JSON.stringify(body), cb.CheckoutRequestID],
    );
    if (!rows[0]) return null;

    if (rows[0].invoice_id) {
      await db.query(
        `UPDATE invoices
         SET paid_amount=paid_amount+$1,
             status=CASE WHEN paid_amount+$1>=total_amount THEN 'completed'::payment_status
                         ELSE status END
         WHERE id=$2`,
        [amount.toFixed(2), rows[0].invoice_id],
      );
    }

    await db.query(
      `UPDATE mpesa_stk_requests
       SET status='completed', raw_callback=$1, completed_at=NOW()
       WHERE checkout_request_id=$2`,
      [JSON.stringify(body), cb.CheckoutRequestID],
    );

    await db.query(
      `UPDATE mpesa_transactions t
       SET status='completed', mpesa_receipt_number=$1,
           raw_response=$2, completed_at=NOW(), phone_number=$3
       FROM mpesa_stk_requests s
       WHERE s.mpesa_transaction_id=t.id AND s.checkout_request_id=$4`,
      [receipt, JSON.stringify(body), phone, cb.CheckoutRequestID],
    );

    return rows[0].id;
  });

  await cacheMpesaStatus(cb.CheckoutRequestID, 'completed');
  return { success: true, mpesaReceiptNumber: receipt, amount, paymentId };
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
): Promise<void> {
  assertSafaricomIp(callerIp);

  await withAdminDb(async (db) => {
    const { rows: existing } = await db.query<{ id: string }>(
      'SELECT id FROM payments WHERE mpesa_receipt_number=$1', [body.TransID],
    );
    if (existing[0]) return;

    const { rows: group } = await db.query<{ id: string }>(
      `SELECT id FROM groups WHERE UPPER(name)=UPPER($1) AND is_active=true LIMIT 1`,
      [body.BillRefNumber],
    );
    if (!group[0]) return;

    const phone  = normalizePhone(body.MSISDN);
    const amount = parseFloat(body.TransAmount).toFixed(2);

    await db.query(
      `INSERT INTO mpesa_transactions
         (group_id, transaction_type, direction, mpesa_receipt_number,
          phone_number, amount, status, reference, raw_response, completed_at)
       VALUES ($1,'c2b','inbound',$2,$3,$4,'completed',$5,$6,NOW())
       ON CONFLICT (mpesa_receipt_number) DO NOTHING`,
      [group[0].id, body.TransID, phone, amount, body.BillRefNumber, JSON.stringify(body)],
    );

    await db.query(
      `INSERT INTO payments
         (group_id, amount, payment_method, status, mpesa_receipt_number,
          mpesa_phone, mpesa_raw_callback, payment_date)
       VALUES ($1,$2,'mpesa','completed',$3,$4,$5,NOW())
       ON CONFLICT (mpesa_receipt_number) DO NOTHING`,
      [group[0].id, amount, body.TransID, phone, JSON.stringify(body)],
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
}

export interface B2CResult {
  conversationId:           string;
  originatorConversationId: string;
  responseDescription:      string;
}

export async function initiateB2C(params: B2CParams): Promise<B2CResult> {
  const phone     = normalizePhone(params.phone);
  const amountStr = toMpesaAmount(params.amount).toFixed(2);

  const res = await _b2c({
    phone,
    amount:    params.amount,
    commandId: params.commandId,
    remarks:   params.occasion,
  });

  await withAdminDb(async (db) => {
    const { rows: txRows } = await db.query<{ id: string }>(
      `INSERT INTO mpesa_transactions
         (group_id, transaction_type, direction, phone_number, amount,
          status, description, conversation_id, originator_conversation_id)
       VALUES ($1,'b2c','outbound',$2,$3,'initiated',$4,$5,$6)
       RETURNING id`,
      [
        params.groupId, phone, amountStr, params.occasion,
        res.conversationId, res.originatorConversationId,
      ],
    );

    await db.query(
      `INSERT INTO mpesa_b2c_transactions
         (group_id, mpesa_transaction_id, conversation_id,
          originator_conversation_id, phone, amount, command_id,
          occasion, remarks, status, loan_id, disbursed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,'initiated',$9,$10)`,
      [
        params.groupId, txRows[0]?.id ?? null,
        res.conversationId, res.originatorConversationId,
        phone, amountStr, params.commandId, params.occasion,
        params.loanId ?? null, params.disbursedBy ?? null,
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
  const r = body.Result;

  await withAdminDb(async (db) => {
    if (r.ResultCode !== 0) {
      await db.query(
        `UPDATE mpesa_b2c_transactions
         SET status='failed', raw_result=$1, result_received_at=NOW()
         WHERE originator_conversation_id=$2`,
        [JSON.stringify(body), r.OriginatorConversationID],
      );
      await db.query(
        `UPDATE mpesa_transactions
         SET status='failed', failure_reason=$1, raw_response=$2, completed_at=NOW()
         WHERE originator_conversation_id=$3`,
        [r.ResultDesc, JSON.stringify(body), r.OriginatorConversationID],
      );
      await db.query(
        `INSERT INTO failed_payment_logs
           (transaction_type, reference_id, failure_reason, failure_code, raw_data)
         VALUES ('b2c',$1,$2,$3,$4)`,
        [r.OriginatorConversationID, r.ResultDesc, String(r.ResultCode), JSON.stringify(body)],
      );
      return;
    }

    const get     = (k: string) => r.ResultParameters?.ResultParameter.find((p) => p.Key === k)?.Value;
    const receipt = get('TransactionReceipt') as string | undefined;

    await db.query(
      `UPDATE mpesa_b2c_transactions
       SET status='completed', mpesa_receipt_number=$1,
           raw_result=$2, result_received_at=NOW()
       WHERE originator_conversation_id=$3`,
      [receipt ?? null, JSON.stringify(body), r.OriginatorConversationID],
    );
    await db.query(
      `UPDATE mpesa_transactions
       SET status='completed', mpesa_receipt_number=$1,
           raw_response=$2, completed_at=NOW()
       WHERE originator_conversation_id=$3`,
      [receipt ?? null, JSON.stringify(body), r.OriginatorConversationID],
    );
  });
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
          await db.query(
            `UPDATE mpesa_stk_requests SET status=$1, completed_at=NOW() WHERE id=$2`,
            [newStatus, req.id],
          );
          await db.query(
            `UPDATE payments SET status=$1
             WHERE mpesa_checkout_request_id=$2 AND status='pending'`,
            [newStatus, req.checkout_request_id],
          );
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
