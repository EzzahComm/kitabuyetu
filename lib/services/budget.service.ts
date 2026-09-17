import { PoolClient } from 'pg';
import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/utils/errors';
import type { PaginatedResult } from '@/types/db.types';
import type {
  CreateBudgetInput, UpdateBudgetInput, BudgetQueryInput, BudgetLineInput, BudgetStatus,
} from '@/lib/validators/budget.schema';

/**
 * Budget tracking (migration 173): planned amounts per real GL account
 * (public.accounts), compared against what has actually been posted to the
 * double-entry ledger (journal_entries/journal_lines) for the budget's own
 * period. No actual amount is ever stored — it is computed live on every
 * read, the same way accounting.service.ts's trial balance / P&L / balance
 * sheet compute their own totals, and reusing that exact debit/credit-normal
 * convention (see fetchLinesWithActuals below).
 */

export interface Budget {
  id:           string;
  group_id:     string;
  name:         string;
  /** ISO date (YYYY-MM-DD) — selected as ::text to avoid JS Date/timezone
   *  round-tripping when these values are fed back into date-range queries. */
  period_start: string;
  period_end:   string;
  status:       BudgetStatus;
  notes:        string | null;
  created_by:   string | null;
  created_at:   Date;
  updated_at:   Date;
}

export interface BudgetLineActual {
  id:             string;
  budget_id:      string;
  account_id:     string;
  account_code:   string;
  account_name:   string;
  account_type:   string;
  planned_amount: string;
  actual_amount:  string;
  /** actual_amount - planned_amount, on the account's own normal-balance side. */
  variance:       string;
  notes:          string | null;
}

export interface BudgetWithLines extends Budget {
  lines: BudgetLineActual[];
}

const BUDGET_COLUMNS = `
  id, group_id, name,
  period_start::text AS period_start, period_end::text AS period_end,
  status, notes, created_by, created_at, updated_at
`;

async function fetchBudgetOrThrow(client: PoolClient, groupId: string, id: string): Promise<Budget> {
  const { rows } = await client.query<Budget>(
    `SELECT ${BUDGET_COLUMNS} FROM budgets WHERE id = $1 AND group_id = $2`,
    [id, groupId],
  );
  if (!rows[0]) throw new NotFoundError('Budget', id);
  return rows[0];
}

/**
 * Per-line actual = what has actually posted to that GL account within the
 * budget's own period, on the account's own normal-balance side — identical
 * convention to accounting.service.ts's getProfitAndLoss (asset/expense are
 * debit-normal; liability/equity/income are credit-normal). The date/status
 * filter lives inside FILTER, never in the LEFT JOIN's ON clause: putting it
 * in the join condition is the exact bug getProfitAndLoss's own comment
 * documents — it silently sums every period ever posted, not just this one.
 */
async function fetchLinesWithActuals(client: PoolClient, budget: Pick<Budget, 'id' | 'period_start' | 'period_end'>): Promise<BudgetLineActual[]> {
  const { rows } = await client.query<Omit<BudgetLineActual, 'variance'>>(
    `SELECT
       bl.id, bl.budget_id, bl.account_id,
       a.account_code, a.name AS account_name, a.type AS account_type,
       bl.planned_amount::text AS planned_amount,
       bl.notes,
       CASE WHEN a.type IN ('asset', 'expense')
         THEN COALESCE(SUM(jl.debit)  FILTER (WHERE je.status = 'posted' AND je.entry_date BETWEEN $2 AND $3), 0)
            - COALESCE(SUM(jl.credit) FILTER (WHERE je.status = 'posted' AND je.entry_date BETWEEN $2 AND $3), 0)
         ELSE COALESCE(SUM(jl.credit) FILTER (WHERE je.status = 'posted' AND je.entry_date BETWEEN $2 AND $3), 0)
            - COALESCE(SUM(jl.debit)  FILTER (WHERE je.status = 'posted' AND je.entry_date BETWEEN $2 AND $3), 0)
       END::text AS actual_amount
     FROM budget_lines bl
     JOIN accounts a ON a.id = bl.account_id
     LEFT JOIN journal_lines jl ON jl.account_id = a.id
       AND jl.entry_date BETWEEN $2 AND $3
     LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id
     WHERE bl.budget_id = $1
     GROUP BY bl.id, bl.budget_id, bl.account_id, a.account_code, a.name, a.type,
              bl.planned_amount, bl.notes
     ORDER BY a.account_code`,
    [budget.id, budget.period_start, budget.period_end],
  );

  return rows.map((r) => ({
    ...r,
    variance: (parseFloat(r.actual_amount) - parseFloat(r.planned_amount)).toFixed(2),
  }));
}

/** A budget line must name a real, active account belonging to THIS group —
 *  RLS scopes group_id on accounts too, but a cross-group id could otherwise
 *  slip through as a plain uuid with no FK-level group check (same class of
 *  gap membership-guard.ts's assertActiveMembership closes for member ids). */
async function assertAccountsBelongToGroup(client: PoolClient, groupId: string, accountIds: string[]): Promise<void> {
  const unique = [...new Set(accountIds)];
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM accounts WHERE group_id = $1 AND id = ANY($2) AND is_active = true`,
    [groupId, unique],
  );
  if (rows.length !== unique.length) {
    const found   = new Set(rows.map((r) => r.id));
    const missing = unique.filter((id) => !found.has(id));
    throw new ValidationError(`Unknown or inactive account id(s): ${missing.join(', ')}`);
  }
}

async function insertBudgetLines(client: PoolClient, groupId: string, budgetId: string, lines: BudgetLineInput[]): Promise<void> {
  for (const line of lines) {
    await client.query(
      `INSERT INTO budget_lines (budget_id, group_id, account_id, planned_amount, notes)
       VALUES ($1, $2, $3, $4, $5)`,
      [budgetId, groupId, line.accountId, line.plannedAmount.toFixed(2), line.notes ?? null],
    );
  }
}

export const budgetService = {

  async list(ctx: TenantContext, params: BudgetQueryInput): Promise<PaginatedResult<Budget>> {
    return withDb(ctx, async (client) => {
      const { page, limit, status, sortDir } = params;
      const offset = (page - 1) * limit;

      const conditions: string[] = ['group_id = $1'];
      const values: unknown[] = [ctx.groupId];
      let idx = 2;
      if (status) { conditions.push(`status = $${idx++}`); values.push(status); }

      const where    = conditions.join(' AND ');
      const orderDir = sortDir === 'asc' ? 'ASC' : 'DESC';

      const { rows: countRows } = await client.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM budgets WHERE ${where}`, values,
      );
      const total = parseInt(countRows[0].count, 10);

      const { rows } = await client.query<Budget>(
        `SELECT ${BUDGET_COLUMNS} FROM budgets
         WHERE ${where}
         ORDER BY period_start ${orderDir}
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...values, limit, offset],
      );

      return { items: rows, total, page, pageSize: limit, totalPages: Math.ceil(total / limit) };
    });
  },

  async getById(ctx: TenantContext, id: string): Promise<BudgetWithLines> {
    return withDb(ctx, async (client) => {
      const budget = await fetchBudgetOrThrow(client, ctx.groupId, id);
      const lines  = await fetchLinesWithActuals(client, budget);
      return { ...budget, lines };
    });
  },

  async create(ctx: TenantContext, data: CreateBudgetInput): Promise<BudgetWithLines> {
    return withTransaction(ctx, async (client) => {
      await assertAccountsBelongToGroup(client, ctx.groupId, data.lines.map((l) => l.accountId));

      const { rows } = await client.query<Budget>(
        `INSERT INTO budgets (group_id, name, period_start, period_end, status, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING ${BUDGET_COLUMNS}`,
        [
          ctx.groupId, data.name, data.periodStart, data.periodEnd,
          data.status ?? 'draft', data.notes ?? null, ctx.userId,
        ],
      );
      const budget = rows[0];

      await insertBudgetLines(client, ctx.groupId, budget.id, data.lines);

      // Audit log — atomic with the budget + lines insert.
      await client.query(
        `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          ctx.groupId, ctx.userId, 'budget.create', 'budget', budget.id, null,
          JSON.stringify({
            name: budget.name, periodStart: budget.period_start, periodEnd: budget.period_end,
            status: budget.status, lineCount: data.lines.length,
          }),
        ],
      );

      const lines = await fetchLinesWithActuals(client, budget);
      return { ...budget, lines };
    });
  },

  async update(ctx: TenantContext, id: string, data: UpdateBudgetInput): Promise<BudgetWithLines> {
    return withTransaction(ctx, async (client) => {
      const { rows: existingRows } = await client.query<Budget>(
        `SELECT ${BUDGET_COLUMNS} FROM budgets WHERE id = $1 AND group_id = $2 FOR UPDATE`,
        [id, ctx.groupId],
      );
      if (!existingRows[0]) throw new NotFoundError('Budget', id);
      const prev = existingRows[0];

      // periodStart/periodEnd may each be supplied independently — re-validate
      // the effective range against whichever side wasn't sent, since the
      // Zod schema can only check a range when both sides are present.
      const nextPeriodStart = data.periodStart ?? prev.period_start;
      const nextPeriodEnd   = data.periodEnd   ?? prev.period_end;
      if (nextPeriodEnd < nextPeriodStart) {
        throw new ValidationError('periodEnd must not be before periodStart');
      }

      const sets: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (data.name        !== undefined) { sets.push(`name = $${idx++}`);         values.push(data.name); }
      if (data.periodStart !== undefined) { sets.push(`period_start = $${idx++}`); values.push(data.periodStart); }
      if (data.periodEnd   !== undefined) { sets.push(`period_end = $${idx++}`);   values.push(data.periodEnd); }
      if (data.status      !== undefined) { sets.push(`status = $${idx++}`);       values.push(data.status); }
      if (data.notes       !== undefined) { sets.push(`notes = $${idx++}`);        values.push(data.notes); }

      let updated = prev;
      if (sets.length) {
        values.push(id, ctx.groupId);
        const { rows } = await client.query<Budget>(
          `UPDATE budgets SET ${sets.join(', ')} WHERE id = $${idx} AND group_id = $${idx + 1} RETURNING ${BUDGET_COLUMNS}`,
          values,
        );
        updated = rows[0];
      }

      if (data.lines !== undefined) {
        await assertAccountsBelongToGroup(client, ctx.groupId, data.lines.map((l) => l.accountId));
        // Full replace, not a merge — simplest correct semantics for a small,
        // officer-edited list (see UpdateBudgetSchema's comment). Safe inside
        // this transaction: a failure after the DELETE rolls the whole update
        // back, so a partial line set is never visible to another reader.
        await client.query(`DELETE FROM budget_lines WHERE budget_id = $1`, [id]);
        await insertBudgetLines(client, ctx.groupId, id, data.lines);
      }

      // Audit log — atomic with the update, old/new values per §1.2's pattern.
      await client.query(
        `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          ctx.groupId, ctx.userId, 'budget.update', 'budget', id,
          JSON.stringify({
            name: prev.name, periodStart: prev.period_start, periodEnd: prev.period_end,
            status: prev.status, notes: prev.notes,
          }),
          JSON.stringify({
            name: updated.name, periodStart: updated.period_start, periodEnd: updated.period_end,
            status: updated.status, notes: updated.notes,
            linesReplaced: data.lines !== undefined ? data.lines.length : undefined,
          }),
        ],
      );

      const lines = await fetchLinesWithActuals(client, updated);
      return { ...updated, lines };
    });
  },

  // Hard delete, deliberately narrower than contributions'/loans' soft-delete
  // pattern: a DRAFT budget has never represented committed real activity (no
  // caller ever priced or reported against it), so nothing is lost by
  // removing it outright — budget_lines cascades via its FK. Anything past
  // draft is refused entirely (RLS's budgets_delete policy backstops the
  // same rule at the DB layer), matching the brief's "a budget with real
  // activity shouldn't vanish".
  async delete(ctx: TenantContext, id: string): Promise<void> {
    return withTransaction(ctx, async (client) => {
      const { rows } = await client.query<Budget>(
        `SELECT ${BUDGET_COLUMNS} FROM budgets WHERE id = $1 AND group_id = $2 AND status = 'draft' FOR UPDATE`,
        [id, ctx.groupId],
      );
      if (!rows[0]) throw new NotFoundError('Draft budget', id);
      const prev = rows[0];

      await client.query(`DELETE FROM budgets WHERE id = $1 AND group_id = $2`, [id, ctx.groupId]);

      await client.query(
        `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          ctx.groupId, ctx.userId, 'budget.delete', 'budget', id,
          JSON.stringify({
            name: prev.name, periodStart: prev.period_start, periodEnd: prev.period_end, status: prev.status,
          }),
          null,
        ],
      );
    });
  },
};
