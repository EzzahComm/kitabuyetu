/**
 * Treasurer-facing unrouted-receipt review workflow (list + resolve). Split
 * out of mpesa.service.ts (OPTIMIZATION_CLEANUP_AUDIT.md High #9).
 */

import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/utils/errors';

export interface UnroutedRow {
  id: string;
  receipt: string;
  phone: string;
  amount: string;
  bill_ref: string | null;
  reason: string;
  candidate_group_id: string | null;
  resolved: boolean;
  created_at: string;
}

/** Lists unresolved receipts awaiting manual allocation for the group. */
export async function listUnrouted(ctx: TenantContext): Promise<UnroutedRow[]> {
  return withDb(ctx, async (db) => {
    const { rows } = await db.query<UnroutedRow>(
      `SELECT id, receipt, phone, amount, bill_ref, reason,
              candidate_group_id, resolved, created_at
       FROM   mpesa_unrouted
       WHERE  resolved = false
       ORDER  BY created_at DESC
       LIMIT  200`,
    );
    return rows;
  });
}

/**
 * Dismisses an unrouted receipt after review. Manual allocation is disabled;
 * only an existing provider-confirmed payment can be corrected through the
 * audited reallocation workflow.
 */
export async function resolveUnrouted(
  ctx: TenantContext,
  id: string,
  action: 'allocate' | 'dismiss',
  opts: { memberId?: string; notes?: string },
): Promise<void> {
  if (String(action) !== 'dismiss') {
    throw new ValidationError('Unrouted receipts cannot be manually allocated. Use the audited reallocation workflow for an existing provider-confirmed payment.');
  }

  return withTransaction(ctx, async (db) => {
    const { rows } = await db.query<{ id: string; resolved: boolean }>(
      `SELECT id, resolved
       FROM mpesa_unrouted
       WHERE id = $1
         AND (candidate_group_id = $2 OR resolved_to_group_id = $2)
       FOR UPDATE`,
      [id, ctx.groupId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError('Unrouted receipt', id);
    if (row.resolved) return;

    await db.query(
      `UPDATE mpesa_unrouted
       SET resolved = true, resolved_by = $2, resolved_at = NOW(),
           resolved_to_group_id = $3, resolution_notes = $4
       WHERE id = $1`,
      [id, ctx.userId, ctx.groupId, opts.notes ?? 'Dismissed'],
    );

    await db.query(
      `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
       VALUES ($1, $2, 'mpesa_unrouted.dismissed', 'mpesa_unrouted', $3, $4, $5)`,
      [
        ctx.groupId,
        ctx.userId,
        id,
        JSON.stringify({ resolved: false }),
        JSON.stringify({ resolved: true, resolution_type: 'dismissed' }),
      ],
    );
  });
}
