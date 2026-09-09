import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { NotFoundError, ConflictError } from '@/lib/utils/errors';
import type { ClosePeriodInput, ReopenPeriodInput } from '@/lib/validators/accounting.schema';

export interface FiscalPeriod {
  id:             string;
  group_id:       string;
  period_start:   string;
  period_end:     string;
  status:         'open' | 'closed';
  closed_by:      string | null;
  closed_at:      string;
  reopened_by:    string | null;
  reopened_at:    string | null;
  reopen_reason:  string | null;
  created_at:     string;
}

/**
 * Fiscal period locking (ACCOUNTING_ARCHITECTURE_AUDIT.md §13 Critical
 * finding). A period only exists as a row once someone closes it — absence
 * of a row means "open" (the trigger in migration 083 treats no-match as
 * unrestricted), so this service never needs to pre-populate a full
 * calendar; it only records close/reopen events.
 */
export const fiscalPeriodsService = {
  async list(ctx: TenantContext): Promise<FiscalPeriod[]> {
    return withDb(ctx, async (client) => {
      const { rows } = await client.query<FiscalPeriod>(
        `SELECT * FROM fiscal_periods WHERE group_id = $1 ORDER BY period_start DESC`,
        [ctx.groupId],
      );
      return rows;
    });
  },

  /** Closes (or re-closes, after a reopen) the given date range for this group. */
  async close(ctx: TenantContext, data: ClosePeriodInput): Promise<FiscalPeriod> {
    return withTransaction(ctx, async (client) => {
      const { rows } = await client.query<FiscalPeriod>(
        `INSERT INTO fiscal_periods (group_id, period_start, period_end, status, closed_by, closed_at)
         VALUES ($1, $2, $3, 'closed', $4, NOW())
         ON CONFLICT (group_id, period_start) DO UPDATE SET
           period_end = EXCLUDED.period_end,
           status = 'closed', closed_by = EXCLUDED.closed_by, closed_at = NOW(),
           reopened_by = NULL, reopened_at = NULL, reopen_reason = NULL,
           updated_at = NOW()
         RETURNING *`,
        [ctx.groupId, data.periodStart, data.periodEnd, ctx.userId],
      );
      await writeAuditLog(client, ctx, 'fiscal_period.closed', rows[0].id, {
        periodStart: data.periodStart, periodEnd: data.periodEnd,
      });
      return rows[0];
    });
  },

  /** Reopens a closed period — requires a reason, fully audited. */
  async reopen(ctx: TenantContext, id: string, data: ReopenPeriodInput): Promise<FiscalPeriod> {
    return withTransaction(ctx, async (client) => {
      const { rows: existing } = await client.query<FiscalPeriod>(
        `SELECT * FROM fiscal_periods WHERE id = $1 AND group_id = $2 FOR UPDATE`,
        [id, ctx.groupId],
      );
      if (!existing[0]) throw new NotFoundError('Fiscal period', id);
      if (existing[0].status !== 'closed') {
        throw new ConflictError('Period is already open');
      }

      const { rows } = await client.query<FiscalPeriod>(
        `UPDATE fiscal_periods
         SET    status = 'open', reopened_by = $2, reopened_at = NOW(), reopen_reason = $3, updated_at = NOW()
         WHERE  id = $1
         RETURNING *`,
        [id, ctx.userId, data.reason],
      );
      await writeAuditLog(client, ctx, 'fiscal_period.reopened', id, { reason: data.reason });
      return rows[0];
    });
  },
};

async function writeAuditLog(
  client: import('pg').PoolClient,
  ctx:    TenantContext,
  action: string,
  resourceId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, new_values)
     VALUES ($1, $2, $3, 'fiscal_period', $4, $5::jsonb)`,
    [ctx.groupId, ctx.userId, action, resourceId, JSON.stringify(payload)],
  );
}
