import type { PoolClient } from 'pg';
import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { NotFoundError } from '@/lib/utils/errors';
import type { SplitRule } from '@/lib/utils/split-allocator';
import type {
  CreateContributionSplitInput,
  UpdateContributionSplitInput,
  ReplaceContributionSplitsInput,
} from '@/lib/validators/contribution-splits.schema';

export interface ContributionSplit {
  id:           string;
  group_id:     string;
  account_code: string;
  percentage:   string | null;
  fixed_amount: string | null;
  priority:     number;
  is_active:    boolean;
  created_by:   string | null;
  created_at:   string;
  updated_at:   string;
}

export const contributionSplitsService = {
  async list(ctx: TenantContext): Promise<ContributionSplit[]> {
    return withDb(ctx, async (client) => {
      const { rows } = await client.query<ContributionSplit>(
        `SELECT * FROM group_contribution_splits
         WHERE group_id = $1
         ORDER BY priority ASC, account_code ASC`,
        [ctx.groupId],
      );
      return rows;
    });
  },

  async create(ctx: TenantContext, data: CreateContributionSplitInput): Promise<ContributionSplit> {
    return withTransaction(ctx, async (client) => {
      const { rows } = await client.query<ContributionSplit>(
        `INSERT INTO group_contribution_splits
           (group_id, account_code, percentage, fixed_amount, priority, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING *`,
        [
          ctx.groupId,
          data.accountCode,
          data.percentage ?? null,
          data.fixedAmount ?? null,
          data.priority,
          ctx.userId,
        ],
      );
      return rows[0];
    });
  },

  async update(
    ctx: TenantContext,
    id: string,
    data: UpdateContributionSplitInput,
  ): Promise<ContributionSplit> {
    return withTransaction(ctx, async (client) => {
      const sets: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      if (data.accountCode !== undefined) { sets.push(`account_code = $${idx++}`); values.push(data.accountCode); }
      if (data.percentage  !== undefined) { sets.push(`percentage = $${idx++}`);   values.push(data.percentage); }
      if (data.fixedAmount !== undefined) { sets.push(`fixed_amount = $${idx++}`); values.push(data.fixedAmount); }
      if (data.priority    !== undefined) { sets.push(`priority = $${idx++}`);     values.push(data.priority); }
      if (data.isActive    !== undefined) { sets.push(`is_active = $${idx++}`);    values.push(data.isActive); }

      if (!sets.length) {
        const { rows } = await client.query<ContributionSplit>(
          'SELECT * FROM group_contribution_splits WHERE id = $1 AND group_id = $2',
          [id, ctx.groupId],
        );
        if (!rows[0]) throw new NotFoundError('Contribution split', id);
        return rows[0];
      }

      values.push(id, ctx.groupId);
      const { rows } = await client.query<ContributionSplit>(
        `UPDATE group_contribution_splits SET ${sets.join(', ')}
         WHERE id = $${idx++} AND group_id = $${idx}
         RETURNING *`,
        values,
      );
      if (!rows[0]) throw new NotFoundError('Contribution split', id);
      return rows[0];
    });
  },

  async remove(ctx: TenantContext, id: string): Promise<void> {
    return withTransaction(ctx, async (client) => {
      const { rowCount } = await client.query(
        'DELETE FROM group_contribution_splits WHERE id = $1 AND group_id = $2',
        [id, ctx.groupId],
      );
      if (!rowCount) throw new NotFoundError('Contribution split', id);
    });
  },

  /**
   * Atomically replace the whole rule set for the group. Used by the
   * "Save all" UI. Deletes then re-inserts inside one transaction.
   */
  async replaceAll(
    ctx: TenantContext,
    data: ReplaceContributionSplitsInput,
  ): Promise<ContributionSplit[]> {
    return withTransaction(ctx, async (client) => {
      await client.query(
        'DELETE FROM group_contribution_splits WHERE group_id = $1',
        [ctx.groupId],
      );
      const out: ContributionSplit[] = [];
      for (const r of data.rules) {
        const { rows } = await client.query<ContributionSplit>(
          `INSERT INTO group_contribution_splits
             (group_id, account_code, percentage, fixed_amount, priority, created_by)
           VALUES ($1,$2,$3,$4,$5,$6)
           RETURNING *`,
          [ctx.groupId, r.accountCode, r.percentage ?? null, r.fixedAmount ?? null, r.priority, ctx.userId],
        );
        out.push(rows[0]);
      }
      return out;
    });
  },
};

/**
 * Loads the active split rules for a group as plain `SplitRule[]` ready for
 * the allocator. Accepts a raw PoolClient so the M-Pesa callback path can
 * call it inside its existing admin transaction (no separate connection).
 * Returns [] when the group hasn't configured any — the allocator then sends
 * 100% to the default account.
 */
export async function loadActiveSplitRules(
  db: PoolClient,
  groupId: string,
): Promise<SplitRule[]> {
  const { rows } = await db.query<{
    account_code: string;
    percentage:   string | null;
    fixed_amount: string | null;
    priority:     number;
  }>(
    `SELECT account_code, percentage, fixed_amount, priority
     FROM   group_contribution_splits
     WHERE  group_id = $1 AND is_active = true
     ORDER  BY priority ASC`,
    [groupId],
  );
  return rows.map((r) => ({
    account_code: r.account_code,
    percentage:   r.percentage   != null ? parseFloat(r.percentage)   : null,
    fixed_amount: r.fixed_amount != null ? parseFloat(r.fixed_amount) : null,
    priority:     r.priority,
  }));
}
