/**
 * Treasurer-facing unrouted-receipt review workflow (list + resolve). Split
 * out of mpesa.service.ts (OPTIMIZATION_CLEANUP_AUDIT.md High #9).
 */

import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { NotFoundError } from '@/lib/utils/errors';
import { assertActiveMembership } from './membership-guard';
import { postContributionJournal } from './accounting.service';
import { IS_SANDBOX, markSpineAllocated } from './mpesa-spine.service';

export interface UnroutedRow {
  id:                 string;
  receipt:            string;
  phone:              string;
  amount:             string;
  bill_ref:           string | null;
  reason:             string;
  candidate_group_id: string | null;
  resolved:           boolean;
  created_at:         string;
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
 * Resolves an unrouted receipt. Two actions:
 *   - 'allocate': create a completed contribution for `memberId` in the group,
 *     post the split journal, and mark the receipt resolved.
 *   - 'dismiss': mark resolved with a note and no contribution (e.g. a
 *     mistaken payment handled out-of-band / reversed).
 */
export async function resolveUnrouted(
  ctx: TenantContext,
  id: string,
  action: 'allocate' | 'dismiss',
  opts: { memberId?: string; notes?: string },
): Promise<void> {
  return withTransaction(ctx, async (db) => {
    const { rows } = await db.query<{
      id: string; receipt: string; phone: string; amount: string;
      bill_ref: string | null; resolved: boolean;
    }>(
      `SELECT id, receipt, phone, amount, bill_ref, resolved
       FROM   mpesa_unrouted
       WHERE  id = $1
         AND  (candidate_group_id = $2 OR resolved_to_group_id = $2)
       FOR UPDATE`,
      [id, ctx.groupId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError('Unrouted receipt', id);
    if (row.resolved) return; // already handled

    if (action === 'dismiss') {
      await db.query(
        `UPDATE mpesa_unrouted
         SET resolved=true, resolved_by=$2, resolved_at=NOW(),
             resolved_to_group_id=$3, resolution_notes=$4
         WHERE id=$1`,
        [id, ctx.userId, ctx.groupId, opts.notes ?? 'Dismissed'],
      );
      return;
    }

    // allocate → create contribution + journal
    if (!opts.memberId) throw new NotFoundError('Member', 'required for allocate');

    // The allocation target must hold an active membership in the resolving
    // group — treasurers must not be able to park receipts on strangers (audit H-1).
    const { membershipId } = await assertActiveMembership(db, ctx.groupId, opts.memberId);

    const amount = parseFloat(row.amount);
    const { rows: contribRows } = await db.query<{ id: string }>(
      `INSERT INTO contributions
         (group_id, member_id, group_membership_id, amount, contribution_date,
          status, payment_method, mpesa_receipt_number, notes, recorded_by)
       VALUES ($1,$2,$3,$4,CURRENT_DATE,'completed','mpesa',$5,$6,$7)
       ON CONFLICT (mpesa_receipt_number) DO NOTHING
       RETURNING id`,
      [
        ctx.groupId, opts.memberId, membershipId, amount.toFixed(2), row.receipt,
        `Manually routed from unrouted receipt (${row.bill_ref ?? 'no ref'})`,
        ctx.userId,
      ],
    );
    const contributionId = contribRows[0]?.id ?? null;
    if (contributionId) {
      await postContributionJournal(db, {
        groupId: ctx.groupId, contributionId, amount,
        entryDate: new Date().toISOString().slice(0, 10), reference: row.receipt,
        createdBy: null, isTest: IS_SANDBOX,
      });

      // Spine: link + flip unrouted → allocated, attributed to the treasurer.
      await db.query(
        `UPDATE contributions
         SET    payment_id = (SELECT id FROM payments WHERE mpesa_receipt_number = $1)
         WHERE  id = $2 AND payment_id IS NULL`,
        [row.receipt, contributionId],
      );
      await markSpineAllocated(db, row.receipt, {
        actor:  ctx.userId,
        detail: { product: 'savings', contributionId, groupId: ctx.groupId, via: 'unrouted_resolution' },
      });
    }

    await db.query(
      `UPDATE mpesa_unrouted
       SET resolved=true, resolved_by=$2, resolved_at=NOW(),
           resolved_to_group_id=$3, resolved_to_contribution=$4,
           resolution_notes=$5
       WHERE id=$1`,
      [id, ctx.userId, ctx.groupId, contributionId, opts.notes ?? 'Allocated to member'],
    );
  });
}
