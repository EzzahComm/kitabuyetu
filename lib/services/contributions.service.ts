import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { NotFoundError, ConflictError } from '@/lib/utils/errors';
import type { Contribution, PaginatedResult } from '@/types/db.types';
import type { CreateContributionInput, UpdateContributionInput, ContributionQueryInput } from '@/lib/validators/contribution.schema';
import { accountingService } from './accounting.service';

export const contributionsService = {

  async list(ctx: TenantContext, params: ContributionQueryInput): Promise<PaginatedResult<Contribution & { member_name: string }>> {
    return withDb(ctx, async (client) => {
      const { page, limit, memberId, status, from, to, sortDir } = params;
      const offset = (page - 1) * limit;

      const conditions: string[] = ['c.group_id = $1'];
      const values: unknown[] = [ctx.groupId];
      let idx = 2;

      if (memberId) { conditions.push(`c.member_id = $${idx++}`);                              values.push(memberId); }
      if (status)   { conditions.push(`c.status = $${idx++}`);                                 values.push(status); }
      if (from)     { conditions.push(`c.contribution_date >= $${idx++}`);                     values.push(from); }
      if (to)       { conditions.push(`c.contribution_date <= $${idx++}`);                     values.push(to); }

      const where   = conditions.join(' AND ');
      const orderDir = sortDir === 'asc' ? 'ASC' : 'DESC';

      const { rows: countRows } = await client.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM contributions c WHERE ${where}`, values,
      );
      const total = parseInt(countRows[0].count, 10);

      const { rows } = await client.query<Contribution & { member_name: string }>(
        `SELECT c.*,
                m.first_name || ' ' || m.last_name AS member_name
         FROM contributions c
         JOIN members m ON m.id = c.member_id
         WHERE ${where}
         ORDER BY c.contribution_date ${orderDir}
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...values, limit, offset],
      );

      return { items: rows, total, page, pageSize: limit, totalPages: Math.ceil(total / limit) };
    });
  },

  // Active members with no completed contribution in the current calendar month.
  // Powers the treasurer home "needs you now" list — small per group, so we
  // return the full set and let the caller cap the preview.
  async nonContributors(ctx: TenantContext): Promise<{ count: number; sample: { id: string; name: string }[] }> {
    return withDb(ctx, async (client) => {
      const { rows } = await client.query<{ id: string; name: string }>(
        `SELECT m.id, m.first_name || ' ' || m.last_name AS name
         FROM group_members gm
         JOIN members m ON m.id = gm.member_id
         WHERE gm.group_id = $1
           AND gm.status = 'active'
           AND NOT EXISTS (
             SELECT 1 FROM contributions c
             WHERE c.member_id = m.id
               AND c.group_id = $1
               AND c.status = 'completed'
               AND c.contribution_date >= date_trunc('month', CURRENT_DATE)
           )
         ORDER BY m.first_name, m.last_name`,
        [ctx.groupId],
      );
      return { count: rows.length, sample: rows.slice(0, 5) };
    });
  },

  async getById(ctx: TenantContext, id: string): Promise<Contribution & { member_name: string }> {
    return withDb(ctx, async (client) => {
      const { rows } = await client.query<Contribution & { member_name: string }>(
        `SELECT c.*, m.first_name || ' ' || m.last_name AS member_name
         FROM contributions c
         JOIN members m ON m.id = c.member_id
         WHERE c.id = $1 AND c.group_id = $2`,
        [id, ctx.groupId],
      );
      if (!rows[0]) throw new NotFoundError('Contribution', id);
      return rows[0];
    });
  },

  async create(ctx: TenantContext, data: CreateContributionInput): Promise<Contribution> {
    return withTransaction(ctx, async (client) => {
      if (data.mpesaReceiptNumber) {
        const dup = await client.query(
          'SELECT id FROM contributions WHERE mpesa_receipt_number = $1',
          [data.mpesaReceiptNumber],
        );
        if (dup.rows[0]) throw new ConflictError(`M-Pesa receipt ${data.mpesaReceiptNumber} already recorded`);
      }

      const { rows } = await client.query<Contribution>(
        `INSERT INTO contributions
           (group_id, member_id, amount, contribution_date, due_date,
            status, payment_method, mpesa_receipt_number, notes, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          ctx.groupId, data.memberId, data.amount.toFixed(2),
          data.contributionDate, data.dueDate ?? null,
          data.paymentMethod ? 'completed' : 'pending',
          data.paymentMethod ?? null,
          data.mpesaReceiptNumber ?? null,
          data.notes ?? null,
          ctx.userId,
        ],
      );

      const contribution = rows[0];

      // Auto-post a journal entry when the contribution is completed on creation
      if (contribution.status === 'completed') {
        await postContributionJournal(client, ctx, contribution);
      }

      return contribution;
    });
  },

  async update(ctx: TenantContext, id: string, data: UpdateContributionInput): Promise<Contribution> {
    return withTransaction(ctx, async (client) => {
      const { rows: existing } = await client.query<Contribution>(
        'SELECT * FROM contributions WHERE id = $1 AND group_id = $2',
        [id, ctx.groupId],
      );
      if (!existing[0]) throw new NotFoundError('Contribution', id);

      const prev = existing[0];

      const sets: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      if (data.status  !== undefined) { sets.push(`status = $${idx++}`);               values.push(data.status); }
      if (data.paymentMethod !== undefined) { sets.push(`payment_method = $${idx++}`); values.push(data.paymentMethod); }
      if (data.mpesaReceiptNumber !== undefined) {
        sets.push(`mpesa_receipt_number = $${idx++}`);
        values.push(data.mpesaReceiptNumber);
      }
      if (data.notes !== undefined) { sets.push(`notes = $${idx++}`);                  values.push(data.notes); }

      if (!sets.length) return prev;

      values.push(id);
      const { rows } = await client.query<Contribution>(
        `UPDATE contributions SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
        values,
      );
      const updated = rows[0];

      // Post journal when status transitions to completed
      if (updated.status === 'completed' && prev.status !== 'completed') {
        await postContributionJournal(client, ctx, updated);
      }

      return updated;
    });
  },

  // Soft-delete only: financial records must never be physically removed.
  // Only pending contributions can be cancelled; completed ones are immutable.
  async delete(ctx: TenantContext, id: string): Promise<void> {
    return withTransaction(ctx, async (client) => {
      const { rowCount } = await client.query(
        `UPDATE contributions SET status = 'cancelled' WHERE id = $1 AND group_id = $2 AND status = 'pending'`,
        [id, ctx.groupId],
      );
      if (!rowCount) throw new NotFoundError('Pending contribution', id);
    });
  },
};

async function postContributionJournal(
  client: import('pg').PoolClient,
  ctx: TenantContext,
  contribution: Contribution,
): Promise<void> {
  const { rows: incomeAcct } = await client.query<{ id: string }>(
    `SELECT id FROM accounts
     WHERE group_id = $1 AND account_code = '4001' AND is_active = true LIMIT 1`,
    [ctx.groupId],
  );
  const { rows: cashAcct } = await client.query<{ id: string }>(
    `SELECT id FROM accounts
     WHERE group_id = $1 AND account_code = '1001' AND is_active = true LIMIT 1`,
    [ctx.groupId],
  );

  if (!incomeAcct[0] || !cashAcct[0]) return;

  const { rows: je } = await client.query<{ id: string }>(
    `INSERT INTO journal_entries (group_id, entry_date, reference, description, status, created_by)
     VALUES ($1, $2, $3, $4, 'posted', $5) RETURNING id`,
    [
      ctx.groupId,
      contribution.contribution_date,
      contribution.mpesa_receipt_number ?? null,
      `Contribution from member — ${contribution.id}`,
      ctx.userId,
    ],
  );
  const jeId = je[0].id;

  await client.query(
    `INSERT INTO journal_lines (group_id, journal_entry_id, account_id, debit, credit)
     VALUES ($1,$2,$3,$4,0), ($1,$2,$5,0,$4)`,
    [ctx.groupId, jeId, cashAcct[0].id, contribution.amount, incomeAcct[0].id],
  );

  await client.query(
    `UPDATE contributions SET journal_entry_id = $1 WHERE id = $2`,
    [jeId, contribution.id],
  );
}
