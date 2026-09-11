/**
 * Unified B2C disbursement spine (payment architecture; closes
 * B2C_DISBURSEMENT_AUDIT.md blockers C1-C5).
 *
 * This is the ONLY path that may call Daraja B2C. Every real-money payout —
 * loan disbursement today, any future group→member payout — goes through
 * initiateDisbursement(). No caller reaches lib/services/mpesa.service.ts's
 * initiateB2C() directly.
 *
 * Pipeline: validate → reserve funds (accounts.reserved_amount) → maker-checker
 * gate (parks pending_approval above the group's threshold) → dispatch (Daraja,
 * outside any DB transaction) → settle on callback (lib/services/mpesa.service.ts
 * handleB2CResult calls releaseDisbursementReservation, which this module does
 * not duplicate — one settlement path, not two).
 *
 * Idempotency (C2): callers supply an idempotency key (the API layer derives
 * one from the Idempotency-Key header); (group_id, idempotency_key) is
 * UNIQUE, and a repeated call with the same key returns the existing row
 * instead of a second real payout — regardless of what state that row is in.
 */
import { withDb, withTransaction, withAdminDb, type TenantContext } from '@/lib/db';
import { NotFoundError, ValidationError, ForbiddenError } from '@/lib/utils/errors';
import { logger } from '@/lib/logger';
import { getEffectiveThreshold } from './approval-policy.service';
import { triggerDisbursementWatchdog } from '@/lib/queue/qstash';

export interface InitiateDisbursementInput {
  loanId?:         string;
  phone:           string;
  amount:          number;
  commandId?:      'BusinessPayment' | 'SalaryPayment' | 'PromotionPayment';
  occasion:        string;
  idempotencyKey:  string;
}

export interface DisbursementRow {
  id:                string;
  group_id:          string;
  loan_id:           string | null;
  phone:             string;
  amount:            string;
  status:            string;
  requires_approval: boolean;
  initiated_by:       string;
  approved_by:        string | null;
  mpesa_receipt_number: string | null;
  failure_reason:     string | null;
  created_at:         Date;
}

export const disbursementsService = {

  /**
   * Validates + reserves funds + either dispatches immediately (single
   * control, under threshold) or parks pending_approval (funds stay
   * reserved while awaiting a second officer). Returns the row either way.
   */
  async initiateDisbursement(
    ctx: TenantContext, input: InitiateDisbursementInput,
  ): Promise<DisbursementRow & { needsApproval: boolean }> {
    if (!(input.amount > 0)) throw new ValidationError('Amount must be positive');
    if (!input.idempotencyKey || input.idempotencyKey.length > 128) {
      throw new ValidationError('A valid idempotency key is required');
    }

    const { row, alreadyExisted } = await withTransaction(ctx, async (db) => {
      // Idempotency (C2): the same key for this group always returns the
      // same logical result, no matter how many times it's replayed.
      const { rows: existing } = await db.query<DisbursementRow>(
        `SELECT * FROM disbursement_requests WHERE group_id = $1 AND idempotency_key = $2`,
        [ctx.groupId, input.idempotencyKey],
      );
      if (existing[0]) return { row: existing[0], alreadyExisted: true };

      // Loan-linked payout: gate on approval status (fixes the pre-existing
      // defect where a rejected/already-disbursed loan could still be paid).
      if (input.loanId) {
        const { rows: loanRows } = await db.query<{ id: string; status: string }>(
          `SELECT id, status FROM loans WHERE id = $1 AND group_id = $2 FOR UPDATE`,
          [input.loanId, ctx.groupId],
        );
        if (!loanRows[0]) throw new NotFoundError('Loan', input.loanId);
        if (loanRows[0].status !== 'approved') {
          throw new ValidationError(
            `Only approved loans can be disbursed (current status: ${loanRows[0].status})`,
          );
        }
      }

      // Balance check (C1): lock the group's cash account, require the
      // amount to fit within available = balance - reserved_amount. Routed
      // through lock_group_cash_account() (migration 100, SECURITY DEFINER)
      // — a plain SELECT ... FOR UPDATE here would also be checked against
      // accounts_update's is_system RLS policy (every real account is
      // is_system = true) even though this never issues a write itself.
      const { rows: acctRows } = await db.query<{ id: string; balance: string; reserved_amount: string }>(
        `SELECT * FROM lock_group_cash_account($1, '1001')`,
        [ctx.groupId],
      );
      if (!acctRows[0]) {
        throw new ValidationError('Group has no active Cash/M-Pesa account (1001) to disburse from');
      }
      const cashAccountId = acctRows[0].id;
      const available = parseFloat(acctRows[0].balance) - parseFloat(acctRows[0].reserved_amount);
      if (input.amount > available) {
        throw new ValidationError(
          `Insufficient available balance (KES ${available.toFixed(2)} available)`,
        );
      }

      // Maker-checker threshold (C3).
      const threshold = await getEffectiveThreshold(db, 'group_disbursement_threshold', { groupId: ctx.groupId });
      const requiresApproval = input.amount > threshold;

      // Reserve (C1/C4): earmark the funds now, before Daraja is ever called
      // — including during the approval-pending window, so a second pending
      // request can't also pass the balance check against the same cash.
      // adjust_account_reserved_amount() (migration 100, SECURITY DEFINER) —
      // see the lock above for why a direct UPDATE needs it too.
      await db.query(
        `SELECT adjust_account_reserved_amount($1, $2)`,
        [cashAccountId, input.amount.toFixed(2)],
      );

      const { rows: inserted } = await db.query<DisbursementRow>(
        `INSERT INTO disbursement_requests
           (idempotency_key, group_id, loan_id, cash_account_id, phone, amount,
            command_id, occasion, status, requires_approval, initiated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          input.idempotencyKey, ctx.groupId, input.loanId ?? null, cashAccountId,
          input.phone, input.amount.toFixed(2), input.commandId ?? 'BusinessPayment',
          input.occasion, requiresApproval ? 'pending_approval' : 'approved',
          requiresApproval, ctx.userId,
        ],
      );
      return { row: inserted[0], alreadyExisted: false };
    });

    // Dispatch happens OUTSIDE the transaction — the Daraja call is a network
    // request and must not hold a Postgres row lock for its duration.
    if (!alreadyExisted && row.status === 'approved') {
      await dispatchDisbursement(row.id);
    }

    const fresh = await this.getById(ctx, row.id);
    return { ...fresh, needsApproval: fresh.requires_approval && fresh.status === 'pending_approval' };
  },

  /** Second-officer approval (maker-checker) — approver ≠ initiator. */
  async approve(ctx: TenantContext, id: string): Promise<DisbursementRow> {
    const row = await withTransaction(ctx, async (db) => {
      const { rows } = await db.query<DisbursementRow>(
        `SELECT * FROM disbursement_requests
         WHERE  id = $1 AND group_id = $2 AND status = 'pending_approval'
         FOR UPDATE`,
        [id, ctx.groupId],
      );
      if (!rows[0]) throw new NotFoundError('Pending disbursement', id);
      if (rows[0].initiated_by === ctx.userId) {
        throw new ForbiddenError('Maker-checker: the initiator cannot approve their own disbursement');
      }
      const { rows: updated } = await db.query<DisbursementRow>(
        `UPDATE disbursement_requests
         SET    status = 'approved', approved_by = $2, approved_at = NOW()
         WHERE  id = $1 RETURNING *`,
        [id, ctx.userId],
      );
      return updated[0];
    });

    await dispatchDisbursement(row.id);
    return this.getById(ctx, row.id);
  },

  /** Reject a pending disbursement — releases the reservation. */
  async reject(ctx: TenantContext, id: string, reason: string): Promise<DisbursementRow> {
    return withTransaction(ctx, async (db) => {
      const { rows } = await db.query<{ cash_account_id: string; amount: string }>(
        `SELECT cash_account_id, amount FROM disbursement_requests
         WHERE  id = $1 AND group_id = $2 AND status = 'pending_approval'
         FOR UPDATE`,
        [id, ctx.groupId],
      );
      if (!rows[0]) throw new NotFoundError('Pending disbursement', id);

      await db.query(
        // String-negate rather than parseFloat/re-serialize, to avoid any
        // float round-trip on a currency value.
        `SELECT adjust_account_reserved_amount($1, $2)`,
        [rows[0].cash_account_id, `-${rows[0].amount}`],
      );
      const { rows: updated } = await db.query<DisbursementRow>(
        `UPDATE disbursement_requests
         SET    status = 'rejected', rejected_by = $2, rejected_at = NOW(), rejection_reason = $3
         WHERE  id = $1 RETURNING *`,
        [id, ctx.userId, reason],
      );
      return updated[0];
    });
  },

  async getById(ctx: TenantContext, id: string): Promise<DisbursementRow> {
    return withDb(ctx, async (db) => {
      const { rows } = await db.query<DisbursementRow>(
        `SELECT * FROM disbursement_requests WHERE id = $1 AND group_id = $2`,
        [id, ctx.groupId],
      );
      if (!rows[0]) throw new NotFoundError('Disbursement', id);
      return rows[0];
    });
  },

  async list(ctx: TenantContext, params: { page: number; limit: number; status?: string }) {
    return withDb(ctx, async (db) => {
      const conds: string[] = ['dr.group_id = $1'];
      const vals: unknown[] = [ctx.groupId];
      let i = 2;
      if (params.status) { conds.push(`dr.status = $${i++}`); vals.push(params.status); }
      const where  = conds.join(' AND ');
      const offset = (params.page - 1) * params.limit;

      const { rows: [{ count }] } = await db.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM disbursement_requests dr WHERE ${where}`, vals,
      );
      const { rows } = await db.query(
        `SELECT dr.*, l.principal_amount, m.first_name || ' ' || m.last_name AS borrower_name,
                im.first_name || ' ' || im.last_name AS initiated_by_name,
                am.first_name || ' ' || am.last_name AS approved_by_name
         FROM   disbursement_requests dr
         LEFT JOIN loans l    ON l.id = dr.loan_id
         LEFT JOIN members m  ON m.id = l.member_id
         LEFT JOIN members im ON im.id = dr.initiated_by
         LEFT JOIN members am ON am.id = dr.approved_by
         WHERE  ${where}
         ORDER  BY dr.created_at DESC
         LIMIT  $${i} OFFSET $${i + 1}`,
        [...vals, params.limit, offset],
      );
      return {
        items: rows, total: parseInt(count, 10), page: params.page,
        pageSize: params.limit, totalPages: Math.ceil(parseInt(count, 10) / params.limit),
      };
    });
  },
};

/**
 * Stuck-payout monitor (B2C audit C5/F13): a 'dispatched' row older than the
 * threshold means Safaricom accepted the request but no result callback has
 * arrived. Safaricom's B2C API offers no generic "query by conversation ID"
 * without a receipt, so this cannot auto-resolve the ambiguity — what it CAN
 * do is guarantee the money never sits in an unknown state *silently*. Every
 * stuck row is logged (the paging signal) so a human reconciles it against
 * the daily Safaricom settlement report, per the audit's §11 recommendation.
 *
 * Also surfaces unreconciled 'timed_out' rows (the disbursement watchdog's
 * own terminal state — lib/services/disbursement-watchdog.service.ts). This
 * is required, not cosmetic: the moment the watchdog flips a row out of
 * 'dispatched', it would otherwise silently vanish from this — the only
 * existing mechanism anything queries for stuck payouts — trading "stuck
 * forever, silently" for "resolved status, but now invisible to the one
 * monitor that exists". A 'timed_out' row keeps paging every run until a
 * human sets reconciled_at, same as a still-'dispatched' row keeps paging
 * until it resolves.
 */
export async function findStuckDisbursements(): Promise<{
  count: number;
  samples: { id: string; groupId: string; amount: string; ageMinutes: number }[];
}> {
  return withAdminDb(async (db) => {
    const { rows } = await db.query<{
      id: string; group_id: string; amount: string; age_minutes: number;
    }>(
      `SELECT id, group_id, amount,
              EXTRACT(EPOCH FROM (NOW() - dispatched_at)) / 60 AS age_minutes
       FROM   disbursement_requests
       WHERE  (status = 'dispatched'
                AND dispatched_at BETWEEN NOW() - INTERVAL '7 days' AND NOW() - INTERVAL '10 minutes')
          OR  (status = 'timed_out' AND reconciled_at IS NULL)
       ORDER  BY dispatched_at ASC
       LIMIT  20`,
    );
    const samples = rows.map((r) => ({
      id: r.id, groupId: r.group_id, amount: r.amount,
      ageMinutes: Math.round(Number(r.age_minutes)),
    }));
    if (samples.length > 0) {
      logger.error('[disbursements] stuck B2C payouts — no result callback received', {
        count: samples.length, samples: samples.slice(0, 5),
      });
    }
    return { count: samples.length, samples };
  });
}

/**
 * Fires the Daraja B2C call for an 'approved' row and flips it to
 * 'dispatched'. Idempotent against races: only a row still in 'approved'
 * transitions, so a concurrent reconciliation sweep or duplicate approval
 * can never dispatch twice. If the Daraja POST itself throws (network/5xx,
 * before any Safaricom response), the reservation is released and the row
 * marked failed — a stuck 'dispatched' row means Safaricom accepted the
 * request and a result callback is genuinely pending.
 */
async function dispatchDisbursement(id: string): Promise<void> {
  const claimed = await withAdminDb(async (db) => {
    const { rows } = await db.query<{
      id: string; group_id: string; loan_id: string | null; phone: string; amount: string;
      command_id: string; occasion: string; initiated_by: string; cash_account_id: string;
    }>(
      `UPDATE disbursement_requests
       SET    status = 'dispatched', dispatched_at = NOW()
       WHERE  id = $1 AND status = 'approved'
       RETURNING id, group_id, loan_id, phone, amount, command_id, occasion,
                 initiated_by, cash_account_id`,
      [id],
    );
    return rows[0] ?? null;
  });
  if (!claimed) return; // already dispatched, or not in a dispatchable state

  try {
    const { initiateB2C } = await import('./mpesa.service');
    await initiateB2C({
      phone:       claimed.phone,
      amount:      parseFloat(claimed.amount),
      occasion:    claimed.occasion,
      commandId:   claimed.command_id as 'BusinessPayment' | 'SalaryPayment' | 'PromotionPayment',
      groupId:     claimed.group_id,
      loanId:      claimed.loan_id ?? undefined,
      disbursedBy: claimed.initiated_by,
      disbursementRequestId: claimed.id,
    });
    // Best-effort watchdog (B2C_DISBURSEMENT_AUDIT.md C5): if Safaricom's
    // result callback never lands, this bounds how long the row can sit
    // 'dispatched' before being surfaced as 'timed_out' instead of silently
    // stuck forever. Never blocks/fails a real dispatch that already
    // succeeded — see triggerDisbursementWatchdog's own non-throwing contract.
    await triggerDisbursementWatchdog({ kind: 'disbursement', rowId: claimed.id });
  } catch (err) {
    // The Daraja POST never landed — release the hold and mark failed so the
    // treasurer can see it and retry with a fresh idempotency key.
    logger.error('[disbursements] dispatch failed before Daraja accepted the request', {
      disbursementId: id, err: String(err),
    });
    await withAdminDb(async (db) => {
      await db.query(
        `UPDATE accounts SET reserved_amount = reserved_amount - $1 WHERE id = $2`,
        [claimed.amount, claimed.cash_account_id],
      );
      await db.query(
        `UPDATE disbursement_requests
         SET    status = 'failed', failure_reason = $2
         WHERE  id = $1 AND status = 'dispatched'`,
        [id, `Dispatch error: ${String(err).slice(0, 500)}`],
      );
    });
  }
}
