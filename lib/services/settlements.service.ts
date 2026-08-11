/**
 * Settlement sweeps — a group moving M-Pesa float to one of its own
 * (activated) bank accounts, via Daraja B2B. Structurally mirrors
 * disbursements.service.ts (the codebase's one existing real-Daraja
 * maker-checker spine) — reserve → dual-approve → dispatch outside the
 * transaction → settle on callback. Unlike disbursements, every settlement
 * always needs a second officer (no under-threshold auto-approval) — the
 * table's own `status` default is 'pending_approval', not conditional.
 *
 * settlement_requests has no cash_account_id column — the group's '1001'
 * account is re-derived via lock_group_cash_account() at each step instead
 * of being stored once.
 */
import { withDb, withTransaction, withAdminDb, type TenantContext } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/utils/errors';
import { logger } from '@/lib/logger';
import { recordApproval } from './settlement-approvals.service';

export interface InitiateSettlementInput {
  bankAccountId:  string;
  amount:         number;
  idempotencyKey: string;
  notes?:         string;
}

export interface SettlementRow {
  id:                        string;
  group_id:                  string;
  bank_account_id:           string;
  amount:                    string;
  status:                    string;
  requested_by:              string | null;
  requested_at:              Date;
  originator_conversation_id: string | null;
  journal_entry_id:          string | null;
  platform_fee:              string | null;
  completed_at:              Date | null;
  failure_reason:            string | null;
  notes:                     string | null;
}

export const settlementsService = {

  async initiate(ctx: TenantContext, input: InitiateSettlementInput): Promise<SettlementRow> {
    if (!(input.amount > 0)) throw new ValidationError('Amount must be positive');
    if (!input.idempotencyKey || input.idempotencyKey.length > 128) {
      throw new ValidationError('A valid idempotency key is required');
    }

    return withTransaction(ctx, async (db) => {
      const { rows: existing } = await db.query<SettlementRow>(
        `SELECT * FROM settlement_requests WHERE group_id = $1 AND idempotency_key = $2`,
        [ctx.groupId, input.idempotencyKey],
      );
      if (existing[0]) return existing[0];

      const { rows: bankRows } = await db.query<{ id: string; status: string }>(
        `SELECT id, status FROM group_bank_accounts WHERE id = $1 AND group_id = $2`,
        [input.bankAccountId, ctx.groupId],
      );
      if (!bankRows[0]) throw new NotFoundError('Bank account', input.bankAccountId);
      if (bankRows[0].status !== 'active') {
        throw new ValidationError(`Bank account is not active (status: ${bankRows[0].status})`);
      }

      const { rows: acctRows } = await db.query<{ id: string; balance: string; reserved_amount: string }>(
        `SELECT * FROM lock_group_cash_account($1, '1001')`,
        [ctx.groupId],
      );
      if (!acctRows[0]) {
        throw new ValidationError('Group has no active Cash/M-Pesa account (1001) to settle from');
      }
      const available = parseFloat(acctRows[0].balance) - parseFloat(acctRows[0].reserved_amount);
      if (input.amount > available) {
        throw new ValidationError(`Insufficient available balance (KES ${available.toFixed(2)} available)`);
      }

      await db.query(`SELECT adjust_account_reserved_amount($1, $2)`, [acctRows[0].id, input.amount.toFixed(2)]);

      const { rows: inserted } = await db.query<SettlementRow>(
        `INSERT INTO settlement_requests
           (group_id, bank_account_id, amount, status, requested_by, idempotency_key, notes)
         VALUES ($1,$2,$3,'pending_approval',$4,$5,$6)
         RETURNING *`,
        [ctx.groupId, input.bankAccountId, input.amount.toFixed(2), ctx.userId, input.idempotencyKey, input.notes ?? null],
      );
      return inserted[0];
    });
  },

  /** Second-officer approval — approver ≠ requester. Dispatches on success. */
  async approve(ctx: TenantContext, id: string): Promise<SettlementRow> {
    const row = await withTransaction(ctx, async (db) => {
      const { rows } = await db.query<SettlementRow>(
        `SELECT * FROM settlement_requests
         WHERE  id = $1 AND group_id = $2 AND status = 'pending_approval'
         FOR UPDATE`,
        [id, ctx.groupId],
      );
      if (!rows[0]) throw new NotFoundError('Pending settlement', id);

      await recordApproval(db, ctx, {
        subjectType: 'settlement', subjectId: id,
        initiatedBy: rows[0].requested_by ?? '', decision: 'approved',
      });

      const { rows: updated } = await db.query<SettlementRow>(
        `UPDATE settlement_requests SET status = 'approved' WHERE id = $1 RETURNING *`,
        [id],
      );
      return updated[0];
    });

    await dispatchSettlement(row.id);
    return this.getById(ctx, row.id);
  },

  async reject(ctx: TenantContext, id: string, reason: string): Promise<SettlementRow> {
    return withTransaction(ctx, async (db) => {
      const { rows } = await db.query<SettlementRow>(
        `SELECT * FROM settlement_requests
         WHERE  id = $1 AND group_id = $2 AND status = 'pending_approval'
         FOR UPDATE`,
        [id, ctx.groupId],
      );
      if (!rows[0]) throw new NotFoundError('Pending settlement', id);

      await recordApproval(db, ctx, {
        subjectType: 'settlement', subjectId: id,
        initiatedBy: rows[0].requested_by ?? '', decision: 'rejected', reason,
      });

      const { rows: acctRows } = await db.query<{ id: string }>(
        `SELECT * FROM lock_group_cash_account($1, '1001')`, [ctx.groupId],
      );
      if (acctRows[0]) {
        await db.query(
          `SELECT adjust_account_reserved_amount($1, $2)`,
          [acctRows[0].id, `-${rows[0].amount}`],
        );
      }

      const { rows: updated } = await db.query<SettlementRow>(
        `UPDATE settlement_requests
         SET    status = 'rejected', failure_reason = $2
         WHERE  id = $1 RETURNING *`,
        [id, reason],
      );
      return updated[0];
    });
  },

  async getById(ctx: TenantContext, id: string): Promise<SettlementRow> {
    return withDb(ctx, async (db) => {
      const { rows } = await db.query<SettlementRow>(
        `SELECT * FROM settlement_requests WHERE id = $1 AND group_id = $2`,
        [id, ctx.groupId],
      );
      if (!rows[0]) throw new NotFoundError('Settlement', id);
      return rows[0];
    });
  },

  async list(ctx: TenantContext): Promise<(SettlementRow & { bank_name: string })[]> {
    return withDb(ctx, async (db) => {
      const { rows } = await db.query<SettlementRow & { bank_name: string }>(
        `SELECT sr.*, ba.bank_name
         FROM   settlement_requests sr
         JOIN   group_bank_accounts ba ON ba.id = sr.bank_account_id
         WHERE  sr.group_id = $1
         ORDER  BY sr.requested_at DESC
         LIMIT  100`,
        [ctx.groupId],
      );
      return rows;
    });
  },
};

/** Same shape as disbursements.service.ts's findStuckDisbursements. */
export async function findStuckSettlements(): Promise<{
  count: number;
  samples: { id: string; groupId: string; amount: string; ageMinutes: number }[];
}> {
  return withAdminDb(async (db) => {
    const { rows } = await db.query<{ id: string; group_id: string; amount: string; age_minutes: number }>(
      `SELECT id, group_id, amount,
              EXTRACT(EPOCH FROM (NOW() - requested_at)) / 60 AS age_minutes
       FROM   settlement_requests
       WHERE  status = 'processing'
         AND  requested_at BETWEEN NOW() - INTERVAL '7 days' AND NOW() - INTERVAL '10 minutes'
       ORDER  BY requested_at ASC
       LIMIT  20`,
    );
    const samples = rows.map((r) => ({
      id: r.id, groupId: r.group_id, amount: r.amount, ageMinutes: Math.round(Number(r.age_minutes)),
    }));
    if (samples.length > 0) {
      logger.error('[settlements] stuck B2B sweeps — no result callback received', {
        count: samples.length, samples: samples.slice(0, 5),
      });
    }
    return { count: samples.length, samples };
  });
}

/**
 * Fires the Daraja B2B call for an 'approved' row and flips it to
 * 'processing'. Same claim-then-dispatch-then-release-on-throw shape as
 * disbursements.service.ts's dispatchDisbursement.
 */
async function dispatchSettlement(id: string): Promise<void> {
  const claimed = await withAdminDb(async (db) => {
    const { rows } = await db.query<{
      id: string; group_id: string; amount: string; bank_account_id: string;
      bank_shortcode: string; bank_account_number: string;
    }>(
      `UPDATE settlement_requests sr
       SET    status = 'processing'
       FROM   group_bank_accounts ba
       WHERE  sr.id = $1 AND sr.status = 'approved' AND ba.id = sr.bank_account_id
       RETURNING sr.id, sr.group_id, sr.amount, sr.bank_account_id,
                 ba.shortcode AS bank_shortcode, ba.account_number AS bank_account_number`,
      [id],
    );
    return rows[0] ?? null;
  });
  if (!claimed) return;

  try {
    const { initiateB2B } = await import('./daraja.service');
    const res = await initiateB2B({
      amount:             parseFloat(claimed.amount),
      receiverShortcode:  claimed.bank_shortcode,
      receiverIdentifier: '4',
      commandId:          'BusinessPayBill',
      accountReference:   claimed.bank_account_number.slice(0, 20),
      remarks:            'Group settlement sweep',
    });
    await withAdminDb((db) =>
      db.query(
        `UPDATE settlement_requests SET originator_conversation_id = $2 WHERE id = $1`,
        [claimed.id, res.originatorConversationId],
      ),
    );
  } catch (err) {
    logger.error('[settlements] dispatch failed before Daraja accepted the request', {
      settlementId: id, err: String(err),
    });
    await withAdminDb(async (db) => {
      const { rows: acctRows } = await db.query<{ id: string }>(
        `SELECT * FROM lock_group_cash_account($1, '1001')`, [claimed.group_id],
      );
      if (acctRows[0]) {
        await db.query(`SELECT adjust_account_reserved_amount($1, $2)`, [acctRows[0].id, `-${claimed.amount}`]);
      }
      await db.query(
        `UPDATE settlement_requests
         SET    status = 'failed', failure_reason = $2
         WHERE  id = $1 AND status = 'processing'`,
        [id, `Dispatch error: ${String(err).slice(0, 500)}`],
      );
    });
  }
}
