/**
 * Vendor payments — a group paying an external supplier via Daraja B2C
 * (phone) or B2B (paybill/till shortcode + account). Same spine as
 * settlements.service.ts / disbursements.service.ts: reserve → dual-approve
 * → dispatch outside the transaction → settle on callback.
 *
 * The one thing this flow has that the others don't: a per-row
 * `expense_account_code`, so a group can book each payment to the right
 * expense account rather than everything landing in 5001. It's validated
 * against the group's own active chart AT CREATION TIME — deliberately not
 * deferred to posting time, because by then the money has already left and a
 * bad code would only surface as a silently-skipped journal entry.
 */
import { withDb, withTransaction, withAdminDb, type TenantContext } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/utils/errors';
import { logger } from '@/lib/logger';
import { recordApproval } from './settlement-approvals.service';
import { triggerDisbursementWatchdog } from '@/lib/queue/qstash';

export interface InitiateVendorPaymentInput {
  channel:             'b2c' | 'b2b';
  payeeName:           string;
  payeePhone?:         string;
  payeeShortcode?:     string;
  payeeAccount?:       string;
  amount:              number;
  expenseAccountCode?: string;
  description?:        string;
  idempotencyKey:      string;
}

export interface VendorPaymentRow {
  id:                        string;
  group_id:                  string;
  channel:                   'b2c' | 'b2b';
  payee_name:                string;
  payee_phone:               string | null;
  payee_shortcode:           string | null;
  payee_account:             string | null;
  amount:                    string;
  expense_account_code:      string;
  description:               string | null;
  status:                    string;
  requested_by:              string | null;
  requested_at:              Date;
  originator_conversation_id: string | null;
  journal_entry_id:          string | null;
  platform_fee:              string | null;
  completed_at:              Date | null;
  failure_reason:            string | null;
  idempotency_key:           string | null;
  /** Set once ops resolves a 'timed_out' row's true outcome. Migration 135. */
  reconciled_at:             Date | null;
}

const DEFAULT_EXPENSE_CODE = '5001';

export const vendorPaymentsService = {

  async initiate(ctx: TenantContext, input: InitiateVendorPaymentInput): Promise<VendorPaymentRow> {
    if (!(input.amount > 0)) throw new ValidationError('Amount must be positive');
    if (!input.idempotencyKey || input.idempotencyKey.length > 128) {
      throw new ValidationError('A valid idempotency key is required');
    }
    // Mirrors the DB's own vendor_payments_dest_chk so a bad combination is
    // a clean 400 rather than a constraint violation.
    if (input.channel === 'b2c' && !input.payeePhone) {
      throw new ValidationError('A payee phone number is required for a B2C vendor payment');
    }
    if (input.channel === 'b2b' && (!input.payeeShortcode || !input.payeeAccount)) {
      throw new ValidationError('A payee shortcode and account are required for a B2B vendor payment');
    }

    const expenseCode = input.expenseAccountCode ?? DEFAULT_EXPENSE_CODE;

    return withTransaction(ctx, async (db) => {
      const { rows: existing } = await db.query<VendorPaymentRow>(
        `SELECT * FROM vendor_payments WHERE group_id = $1 AND idempotency_key = $2`,
        [ctx.groupId, input.idempotencyKey],
      );
      if (existing[0]) return existing[0];

      // Validate the expense account NOW — see the file header for why this
      // can't wait until the GL posting runs.
      const { rows: acctCheck } = await db.query<{ account_code: string }>(
        `SELECT account_code FROM accounts
         WHERE  group_id = $1 AND account_code = $2 AND is_active = true`,
        [ctx.groupId, expenseCode],
      );
      if (!acctCheck[0]) {
        throw new ValidationError(
          `Expense account ${expenseCode} does not exist in this group's active chart of accounts`,
        );
      }

      const { rows: acctRows } = await db.query<{ id: string; balance: string; reserved_amount: string }>(
        `SELECT * FROM lock_group_cash_account($1, '1001')`,
        [ctx.groupId],
      );
      if (!acctRows[0]) {
        throw new ValidationError('Group has no active Cash/M-Pesa account (1001) to pay from');
      }
      const available = parseFloat(acctRows[0].balance) - parseFloat(acctRows[0].reserved_amount);
      if (input.amount > available) {
        throw new ValidationError(`Insufficient available balance (KES ${available.toFixed(2)} available)`);
      }

      await db.query(`SELECT adjust_account_reserved_amount($1, $2)`, [acctRows[0].id, input.amount.toFixed(2)]);

      const { rows: inserted } = await db.query<VendorPaymentRow>(
        `INSERT INTO vendor_payments
           (group_id, channel, payee_name, payee_phone, payee_shortcode, payee_account,
            amount, expense_account_code, description, status, requested_by, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending_approval',$10,$11)
         RETURNING *`,
        [
          ctx.groupId, input.channel, input.payeeName,
          input.payeePhone ?? null, input.payeeShortcode ?? null, input.payeeAccount ?? null,
          input.amount.toFixed(2), expenseCode, input.description ?? null,
          ctx.userId, input.idempotencyKey,
        ],
      );
      return inserted[0];
    });
  },

  async approve(ctx: TenantContext, id: string): Promise<VendorPaymentRow> {
    const row = await withTransaction(ctx, async (db) => {
      const { rows } = await db.query<VendorPaymentRow>(
        `SELECT * FROM vendor_payments
         WHERE  id = $1 AND group_id = $2 AND status = 'pending_approval'
         FOR UPDATE`,
        [id, ctx.groupId],
      );
      if (!rows[0]) throw new NotFoundError('Pending vendor payment', id);

      await recordApproval(db, ctx, {
        subjectType: 'vendor_payment', subjectId: id,
        initiatedBy: rows[0].requested_by ?? '', decision: 'approved',
      });

      const { rows: updated } = await db.query<VendorPaymentRow>(
        `UPDATE vendor_payments SET status = 'approved' WHERE id = $1 RETURNING *`,
        [id],
      );
      return updated[0];
    });

    await dispatchVendorPayment(row.id);
    return this.getById(ctx, row.id);
  },

  async reject(ctx: TenantContext, id: string, reason: string): Promise<VendorPaymentRow> {
    return withTransaction(ctx, async (db) => {
      const { rows } = await db.query<VendorPaymentRow>(
        `SELECT * FROM vendor_payments
         WHERE  id = $1 AND group_id = $2 AND status = 'pending_approval'
         FOR UPDATE`,
        [id, ctx.groupId],
      );
      if (!rows[0]) throw new NotFoundError('Pending vendor payment', id);

      await recordApproval(db, ctx, {
        subjectType: 'vendor_payment', subjectId: id,
        initiatedBy: rows[0].requested_by ?? '', decision: 'rejected', reason,
      });

      const { rows: acctRows } = await db.query<{ id: string }>(
        `SELECT * FROM lock_group_cash_account($1, '1001')`, [ctx.groupId],
      );
      if (acctRows[0]) {
        await db.query(`SELECT adjust_account_reserved_amount($1, $2)`, [acctRows[0].id, `-${rows[0].amount}`]);
      }

      const { rows: updated } = await db.query<VendorPaymentRow>(
        `UPDATE vendor_payments
         SET    status = 'rejected', failure_reason = $2
         WHERE  id = $1 RETURNING *`,
        [id, reason],
      );
      return updated[0];
    });
  },

  async getById(ctx: TenantContext, id: string): Promise<VendorPaymentRow> {
    return withDb(ctx, async (db) => {
      const { rows } = await db.query<VendorPaymentRow>(
        `SELECT * FROM vendor_payments WHERE id = $1 AND group_id = $2`,
        [id, ctx.groupId],
      );
      if (!rows[0]) throw new NotFoundError('Vendor payment', id);
      return rows[0];
    });
  },

  async list(ctx: TenantContext): Promise<VendorPaymentRow[]> {
    return withDb(ctx, async (db) => {
      const { rows } = await db.query<VendorPaymentRow>(
        `SELECT * FROM vendor_payments WHERE group_id = $1 ORDER BY requested_at DESC LIMIT 100`,
        [ctx.groupId],
      );
      return rows;
    });
  },
};

/**
 * Same shape as findStuckDisbursements / findStuckSettlements, including the
 * same requirement to also surface unreconciled 'timed_out' rows — see
 * findStuckDisbursements' own comment for why this isn't optional once the
 * watchdog can write that status.
 */
export async function findStuckVendorPayments(): Promise<{
  count: number;
  samples: { id: string; groupId: string; amount: string; ageMinutes: number }[];
}> {
  return withAdminDb(async (db) => {
    const { rows } = await db.query<{ id: string; group_id: string; amount: string; age_minutes: number }>(
      `SELECT id, group_id, amount,
              EXTRACT(EPOCH FROM (NOW() - requested_at)) / 60 AS age_minutes
       FROM   vendor_payments
       WHERE  (status = 'processing'
                AND requested_at BETWEEN NOW() - INTERVAL '7 days' AND NOW() - INTERVAL '10 minutes')
          OR  (status = 'timed_out' AND reconciled_at IS NULL)
       ORDER  BY requested_at ASC
       LIMIT  20`,
    );
    const samples = rows.map((r) => ({
      id: r.id, groupId: r.group_id, amount: r.amount, ageMinutes: Math.round(Number(r.age_minutes)),
    }));
    if (samples.length > 0) {
      logger.error('[vendor-payments] stuck payouts — no result callback received', {
        count: samples.length, samples: samples.slice(0, 5),
      });
    }
    return { count: samples.length, samples };
  });
}

/**
 * Fires the Daraja call for an 'approved' row and flips it to 'processing'.
 * Channel decides which Daraja product: B2C for a phone payee, B2B for a
 * paybill/till. Same claim-then-dispatch-then-release-on-throw shape as
 * every other outbound money path in this codebase.
 */
async function dispatchVendorPayment(id: string): Promise<void> {
  const claimed = await withAdminDb(async (db) => {
    const { rows } = await db.query<{
      id: string; group_id: string; amount: string; channel: 'b2c' | 'b2b';
      payee_name: string; payee_phone: string | null;
      payee_shortcode: string | null; payee_account: string | null;
    }>(
      `UPDATE vendor_payments
       SET    status = 'processing'
       WHERE  id = $1 AND status = 'approved'
       RETURNING id, group_id, amount, channel, payee_name, payee_phone,
                 payee_shortcode, payee_account`,
      [id],
    );
    return rows[0] ?? null;
  });
  if (!claimed) return;

  try {
    const amount = parseFloat(claimed.amount);
    let originatorConversationId: string;

    if (claimed.channel === 'b2c') {
      const { initiateB2C } = await import('./daraja.service');
      const res = await initiateB2C({
        phone:     claimed.payee_phone!,
        amount,
        commandId: 'BusinessPayment',
        occasion:  `Vendor payment — ${claimed.payee_name}`.slice(0, 100),
        remarks:   `Vendor payment — ${claimed.payee_name}`.slice(0, 100),
      });
      originatorConversationId = res.originatorConversationId;
    } else {
      const { initiateB2B } = await import('./daraja.service');
      const res = await initiateB2B({
        amount,
        receiverShortcode:  claimed.payee_shortcode!,
        receiverIdentifier: '4',
        commandId:          'BusinessPayBill',
        accountReference:   claimed.payee_account!.slice(0, 20),
        remarks:            `Vendor payment — ${claimed.payee_name}`.slice(0, 100),
      });
      originatorConversationId = res.originatorConversationId;
    }

    await withAdminDb((db) =>
      db.query(
        `UPDATE vendor_payments SET originator_conversation_id = $2 WHERE id = $1`,
        [claimed.id, originatorConversationId],
      ),
    );
    // Best-effort watchdog (B2C_DISBURSEMENT_AUDIT.md C5, extended to vendor
    // payments — see disbursements.service.ts's dispatchDisbursement for the
    // identical pattern). Never blocks/fails a dispatch that already succeeded.
    await triggerDisbursementWatchdog({ kind: 'vendor_payment', rowId: claimed.id });
  } catch (err) {
    logger.error('[vendor-payments] dispatch failed before Daraja accepted the request', {
      vendorPaymentId: id, err: String(err),
    });
    await withAdminDb(async (db) => {
      const { rows: acctRows } = await db.query<{ id: string }>(
        `SELECT * FROM lock_group_cash_account($1, '1001')`, [claimed.group_id],
      );
      if (acctRows[0]) {
        await db.query(`SELECT adjust_account_reserved_amount($1, $2)`, [acctRows[0].id, `-${claimed.amount}`]);
      }
      await db.query(
        `UPDATE vendor_payments
         SET    status = 'failed', failure_reason = $2
         WHERE  id = $1 AND status = 'processing'`,
        [id, `Dispatch error: ${String(err).slice(0, 500)}`],
      );
    });
  }
}
