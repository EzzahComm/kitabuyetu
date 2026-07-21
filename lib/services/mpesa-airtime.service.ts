/**
 * M-Pesa airtime purchase: initiation and async result callback. Split out
 * of mpesa.service.ts (OPTIMIZATION_CLEANUP_AUDIT.md High #9).
 */

import { withAdminDb } from '@/lib/db';
import { normalizePhone } from '@/lib/utils/phone';
import { toMpesaAmount } from '@/lib/utils/currency';
import { buyAirtime as _buyAirtime, assertSafaricomIp } from './daraja.service';
import { IS_SANDBOX } from './mpesa-spine.service';

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
