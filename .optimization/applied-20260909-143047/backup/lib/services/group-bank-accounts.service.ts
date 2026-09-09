/**
 * Group bank accounts — settlement destinations. Dual-control on activation:
 * a bank account can't receive a real settlement sweep until a second
 * officer confirms it (a wrong shortcode/account number here sends real
 * money to the wrong place). Disabling is single-actor — turning a
 * destination off reduces risk, doesn't need a second officer, matching this
 * codebase's existing precedent for other risk-reducing-only actions.
 */
import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { NotFoundError } from '@/lib/utils/errors';
import { recordApproval } from './settlement-approvals.service';
import type { CreateGroupBankAccountInput } from '@/lib/validators/group-bank-accounts.schema';

export interface GroupBankAccountRow {
  id:             string;
  group_id:       string;
  bank_name:      string;
  shortcode:      string;
  account_number: string;
  label:          string | null;
  status:         'pending_approval' | 'active' | 'rejected' | 'disabled';
  created_by:     string | null;
  created_at:     Date;
  activated_at:   Date | null;
  notes:          string | null;
}

export const groupBankAccountsService = {

  async create(ctx: TenantContext, input: CreateGroupBankAccountInput): Promise<GroupBankAccountRow> {
    return withTransaction(ctx, async (db) => {
      const { rows } = await db.query<GroupBankAccountRow>(
        `INSERT INTO group_bank_accounts
           (group_id, bank_name, shortcode, account_number, label, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [ctx.groupId, input.bankName, input.shortcode, input.accountNumber,
         input.label ?? null, input.notes ?? null, ctx.userId],
      );
      return rows[0];
    });
  },

  /** Second-officer activation (maker-checker) — approver ≠ creator. */
  async activate(ctx: TenantContext, id: string): Promise<GroupBankAccountRow> {
    return withTransaction(ctx, async (db) => {
      const { rows } = await db.query<GroupBankAccountRow>(
        `SELECT * FROM group_bank_accounts
         WHERE  id = $1 AND group_id = $2 AND status = 'pending_approval'
         FOR UPDATE`,
        [id, ctx.groupId],
      );
      if (!rows[0]) throw new NotFoundError('Pending bank account', id);

      await recordApproval(db, ctx, {
        subjectType: 'bank_account', subjectId: id,
        initiatedBy: rows[0].created_by ?? '', decision: 'approved',
      });

      const { rows: updated } = await db.query<GroupBankAccountRow>(
        `UPDATE group_bank_accounts
         SET    status = 'active', activated_at = NOW()
         WHERE  id = $1 RETURNING *`,
        [id],
      );
      return updated[0];
    });
  },

  async reject(ctx: TenantContext, id: string, reason: string): Promise<GroupBankAccountRow> {
    return withTransaction(ctx, async (db) => {
      const { rows } = await db.query<GroupBankAccountRow>(
        `SELECT * FROM group_bank_accounts
         WHERE  id = $1 AND group_id = $2 AND status = 'pending_approval'
         FOR UPDATE`,
        [id, ctx.groupId],
      );
      if (!rows[0]) throw new NotFoundError('Pending bank account', id);

      await recordApproval(db, ctx, {
        subjectType: 'bank_account', subjectId: id,
        initiatedBy: rows[0].created_by ?? '', decision: 'rejected', reason,
      });

      const { rows: updated } = await db.query<GroupBankAccountRow>(
        `UPDATE group_bank_accounts SET status = 'rejected' WHERE id = $1 RETURNING *`,
        [id],
      );
      return updated[0];
    });
  },

  /** Single-actor — no maker-checker for turning a destination off. */
  async disable(ctx: TenantContext, id: string, reason?: string): Promise<GroupBankAccountRow> {
    return withTransaction(ctx, async (db) => {
      const { rows } = await db.query<GroupBankAccountRow>(
        `SELECT * FROM group_bank_accounts
         WHERE  id = $1 AND group_id = $2 AND status = 'active'
         FOR UPDATE`,
        [id, ctx.groupId],
      );
      if (!rows[0]) throw new NotFoundError('Active bank account', id);

      const { rows: updated } = await db.query<GroupBankAccountRow>(
        `UPDATE group_bank_accounts
         SET    status = 'disabled', notes = COALESCE($2, notes)
         WHERE  id = $1 RETURNING *`,
        [id, reason ?? null],
      );
      return updated[0];
    });
  },

  async getById(ctx: TenantContext, id: string): Promise<GroupBankAccountRow> {
    return withDb(ctx, async (db) => {
      const { rows } = await db.query<GroupBankAccountRow>(
        `SELECT * FROM group_bank_accounts WHERE id = $1 AND group_id = $2`,
        [id, ctx.groupId],
      );
      if (!rows[0]) throw new NotFoundError('Bank account', id);
      return rows[0];
    });
  },

  /** Active bank accounts only — the set a settlement can actually target. */
  async listActive(ctx: TenantContext): Promise<GroupBankAccountRow[]> {
    return withDb(ctx, async (db) => {
      const { rows } = await db.query<GroupBankAccountRow>(
        `SELECT * FROM group_bank_accounts WHERE group_id = $1 AND status = 'active' ORDER BY bank_name`,
        [ctx.groupId],
      );
      return rows;
    });
  },

  async list(ctx: TenantContext): Promise<GroupBankAccountRow[]> {
    return withDb(ctx, async (db) => {
      const { rows } = await db.query<GroupBankAccountRow>(
        `SELECT * FROM group_bank_accounts WHERE group_id = $1 ORDER BY created_at DESC`,
        [ctx.groupId],
      );
      return rows;
    });
  },
};
