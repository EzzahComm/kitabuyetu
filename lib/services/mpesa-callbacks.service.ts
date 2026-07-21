/**
 * M-Pesa callback audit log, DLQ replay, and the misc async-result callbacks
 * (reversal, balance, transaction status). Split out of mpesa.service.ts
 * (OPTIMIZATION_CLEANUP_AUDIT.md High #9).
 */

import { withAdminDb } from '@/lib/db';
import { assertSafaricomIp } from './daraja.service';
import { handleSTKCallback, type StkCallbackBody } from './mpesa-stk.service';
import { handleC2BConfirmation, type C2BCallbackBody } from './mpesa-c2b.service';

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
