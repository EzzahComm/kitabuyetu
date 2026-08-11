/**
 * Daraja result-callback settlement for the two outbound flows this feature
 * owns: settlement sweeps (B2B) and vendor payments (B2C or B2B).
 *
 * Structurally copies mpesa-b2c.service.ts's handleB2CResult: claim the row
 * `FOR UPDATE` by originator_conversation_id, branch success/failure, release
 * the cash reservation exactly once, post the GL entry on success, and write
 * a failed_payment_logs row on failure.
 *
 * Both handlers are safe no-ops when the OriginatorConversationID doesn't
 * belong to their table — the existing B2B/B2C routes call every handler for
 * each callback rather than dispatching on type, so "not my row" must mean
 * "do nothing", not "error". That's also what makes a replayed callback
 * harmless: the `WHERE status = 'processing'` guard matches nothing the
 * second time.
 */
import { withAdminDb } from '@/lib/db';
import type { PoolClient } from 'pg';
import { logger } from '@/lib/logger';
import { assertSafaricomIp } from './daraja.service';
import { computeB2BCharge, computeB2CCharge } from './mpesa-charges.service';
import { postSettlementSweepJournal, postVendorPaymentJournal } from './posting-templates.service';

interface DarajaResult {
  Result?: {
    ResultCode?:               number;
    ResultDesc?:               string;
    OriginatorConversationID?: string;
    ConversationID?:           string;
    ResultParameters?:         { ResultParameter?: { Key: string; Value: unknown }[] };
  };
}

function parseResult(body: Record<string, unknown>) {
  const r = (body as DarajaResult).Result;
  if (!r?.OriginatorConversationID) return null;
  const get = (k: string) => r.ResultParameters?.ResultParameter?.find((p) => p.Key === k)?.Value;
  return {
    origId:  r.OriginatorConversationID,
    success: r.ResultCode === 0,
    desc:    r.ResultDesc ?? '',
    code:    r.ResultCode,
    receipt: (get('TransactionReceipt') as string | undefined) ?? null,
  };
}

/**
 * Releases the cash reservation held against a group's 1001 account.
 * Uses the same SECURITY DEFINER RPCs the disbursement spine does — a plain
 * UPDATE would be blocked by accounts_update's is_system guard.
 */
async function releaseCashReservation(db: PoolClient, groupId: string, amount: string): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT * FROM lock_group_cash_account($1, '1001')`, [groupId],
  );
  if (rows[0]) {
    await db.query(`SELECT adjust_account_reserved_amount($1, $2)`, [rows[0].id, `-${amount}`]);
  }
}

/** Settlement sweep (B2B) result callback. */
export async function handleSettlementB2BResult(
  body: Record<string, unknown>,
  callerIp: string,
): Promise<void> {
  assertSafaricomIp(callerIp);
  const parsed = parseResult(body);
  if (!parsed) return;
  const rawBody = JSON.stringify(body);

  await withAdminDb(async (db) => {
    const { rows } = await db.query<{
      id: string; group_id: string; amount: string;
    }>(
      `SELECT id, group_id, amount FROM settlement_requests
       WHERE  originator_conversation_id = $1 AND status = 'processing'
       FOR UPDATE`,
      [parsed.origId],
    );
    const row = rows[0];
    if (!row) return; // not a settlement, or already settled (replayed callback)

    if (!parsed.success) {
      await db.query(
        `UPDATE settlement_requests
         SET    status = 'failed', failure_reason = $2, completed_at = NOW()
         WHERE  id = $1`,
        [row.id, parsed.desc.slice(0, 500)],
      );
      await db.query(
        `INSERT INTO failed_payment_logs
           (group_id, transaction_type, reference_id, failure_reason, failure_code, raw_data)
         VALUES ($1,'b2b',$2,$3,$4,$5)`,
        [row.group_id, parsed.origId, parsed.desc, String(parsed.code), rawBody],
      );
      await releaseCashReservation(db, row.group_id, row.amount);
      return;
    }

    const amount = parseFloat(row.amount);
    const fee    = await computeB2BCharge(db, amount);

    const jeId = await postSettlementSweepJournal(db, {
      groupId:      row.group_id,
      settlementId: row.id,
      amount,
      fee,
      entryDate:    new Date(),
      reference:    parsed.receipt ?? parsed.origId,
      createdBy:    null,
    });
    if (!jeId) {
      // The money already moved — a missing chart account is a reconciliation
      // gap to surface, never a reason to mark the settlement failed.
      logger.error('[settlements] sweep completed but GL posting was skipped', {
        settlementId: row.id, groupId: row.group_id,
      });
    }

    await db.query(
      `UPDATE settlement_requests
       SET    status = 'completed', completed_at = NOW(), platform_fee = $2
       WHERE  id = $1`,
      [row.id, fee.toFixed(2)],
    );
    await releaseCashReservation(db, row.group_id, row.amount);
  });
}

/**
 * Vendor payment result callback — one handler for both channels, called
 * from both the B2B and B2C routes (a given payment's
 * originator_conversation_id only ever matches one of them).
 */
export async function handleVendorPaymentResult(
  body: Record<string, unknown>,
  callerIp: string,
): Promise<void> {
  assertSafaricomIp(callerIp);
  const parsed = parseResult(body);
  if (!parsed) return;
  const rawBody = JSON.stringify(body);

  await withAdminDb(async (db) => {
    const { rows } = await db.query<{
      id: string; group_id: string; amount: string; channel: 'b2c' | 'b2b';
      expense_account_code: string; payee_name: string;
    }>(
      `SELECT id, group_id, amount, channel, expense_account_code, payee_name
       FROM   vendor_payments
       WHERE  originator_conversation_id = $1 AND status = 'processing'
       FOR UPDATE`,
      [parsed.origId],
    );
    const row = rows[0];
    if (!row) return; // not a vendor payment, or already settled

    if (!parsed.success) {
      await db.query(
        `UPDATE vendor_payments
         SET    status = 'failed', failure_reason = $2, completed_at = NOW()
         WHERE  id = $1`,
        [row.id, parsed.desc.slice(0, 500)],
      );
      await db.query(
        `INSERT INTO failed_payment_logs
           (group_id, transaction_type, reference_id, failure_reason, failure_code, raw_data)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [row.group_id, row.channel, parsed.origId, parsed.desc, String(parsed.code), rawBody],
      );
      await releaseCashReservation(db, row.group_id, row.amount);
      return;
    }

    const amount = parseFloat(row.amount);
    const fee    = row.channel === 'b2b'
      ? await computeB2BCharge(db, amount)
      : await computeB2CCharge(db, amount);

    const jeId = await postVendorPaymentJournal(db, {
      groupId:            row.group_id,
      vendorPaymentId:    row.id,
      amount,
      fee,
      expenseAccountCode: row.expense_account_code,
      entryDate:          new Date(),
      reference:          parsed.receipt ?? parsed.origId,
      createdBy:          null,
    });
    if (!jeId) {
      logger.error('[vendor-payments] payment completed but GL posting was skipped', {
        vendorPaymentId: row.id, groupId: row.group_id, expenseAccountCode: row.expense_account_code,
      });
    }

    await db.query(
      `UPDATE vendor_payments
       SET    status = 'completed', completed_at = NOW(), platform_fee = $2
       WHERE  id = $1`,
      [row.id, fee.toFixed(2)],
    );
    await releaseCashReservation(db, row.group_id, row.amount);
  });
}
