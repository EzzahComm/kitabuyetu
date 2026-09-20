/**
 * M-Pesa B2B result callback. Split out of mpesa.service.ts
 * (OPTIMIZATION_CLEANUP_AUDIT.md High #9).
 */

import { withAdminDb } from '@/lib/db';
import { assertSafaricomIp } from './daraja.service';

export async function handleB2BResult(body: Record<string, unknown>, callerIp: string): Promise<void> {
  assertSafaricomIp(callerIp);

  type RawResult = {
    Result?: {
      ResultCode?: number;
      OriginatorConversationID?: string;
      ConversationID?: string;
      ResultParameters?: { ResultParameter?: { Key: string; Value: unknown }[] };
    };
  };
  const r = (body as RawResult).Result;
  if (!r) return;

  const origId = r.OriginatorConversationID ?? '';
  const success = r.ResultCode === 0;
  const get = (k: string) => r.ResultParameters?.ResultParameter?.find((p) => p.Key === k)?.Value;
  const receipt = get('TransactionReceipt') as string | undefined;

  await withAdminDb(async (db) => {
    // Fetch existing B2B transaction to capture old values
    const { rows: existingB2b } = await db.query<{ id: string; status: string }>(
      `SELECT id, status FROM mpesa_b2b_transactions WHERE originator_conversation_id = $1`,
      [origId],
    );

    const newStatus = success ? 'completed' : 'failed';
    await db.query(
      `UPDATE mpesa_b2b_transactions
       SET status=$1, mpesa_receipt_number=$2, raw_result=$3, result_received_at=NOW()
       WHERE originator_conversation_id=$4`,
      [newStatus, receipt ?? null, JSON.stringify(body), origId],
    );

    // Record audit log for B2B transaction (system-triggered, so actor_id is null)
    if (existingB2b[0]) {
      await db.query(
        `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, old_values, new_values)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          null, // system-triggered callback
          'mpesa_b2b.callback_result',
          'mpesa_b2b_transaction',
          existingB2b[0].id,
          JSON.stringify({ status: existingB2b[0].status, mpesa_receipt_number: null }),
          JSON.stringify({ status: newStatus, mpesa_receipt_number: receipt ?? null }),
        ],
      );
    }

    // Fetch existing transaction to capture old values
    const { rows: existingTx } = await db.query<{ id: string; status: string }>(
      `SELECT id, status FROM mpesa_transactions WHERE originator_conversation_id = $1`,
      [origId],
    );

    await db.query(
      `UPDATE mpesa_transactions
       SET status=$1, mpesa_receipt_number=$2, raw_response=$3, completed_at=NOW()
       WHERE originator_conversation_id=$4`,
      [newStatus, receipt ?? null, JSON.stringify(body), origId],
    );

    // Record audit log for main transaction (system-triggered)
    if (existingTx[0]) {
      await db.query(
        `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, old_values, new_values)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          null, // system-triggered callback
          'mpesa_transaction.callback_result',
          'mpesa_transaction',
          existingTx[0].id,
          JSON.stringify({ status: existingTx[0].status, mpesa_receipt_number: null }),
          JSON.stringify({ status: newStatus, mpesa_receipt_number: receipt ?? null }),
        ],
      );
    }
  });
}
