/**
 * Payment reallocations — the correction flow of the payment spine
 * (payment architecture §3.4, §11, §15.5; ADR-8, ADR-20).
 *
 * A payment allocated to the wrong member is never edited or deleted.
 * Instead the correction is recorded as a payment_reallocations row that,
 * on execution:
 *
 *   1. voids the original contribution (status → 'cancelled'; amount,
 *      receipt, and payment link stay on the row forever — it remains the
 *      historical fact of where the money first landed),
 *   2. posts a CONTRA journal (original lines with debit/credit swapped),
 *   3. creates the corrected contribution for the target membership
 *      (no receipt/payment_id — those uniques stay with the original;
 *      payment_reallocations.to_domain_id carries the linkage),
 *   4. mirrors the original journal onto the new membership,
 *   5. flips the spine to allocation_status='reallocated' and appends the
 *      'reallocated' payment_event + outbox event.
 *
 * Maker-checker (ADR-20): corrections above the group's
 * reallocation_approval_threshold wait in 'pending_approval' until a
 * DIFFERENT officer approves; below the threshold they execute immediately
 * under single control. Scope v1: M-Pesa-linked savings contributions within
 * one group (cash corrections use the existing contribution edit flow;
 * cross-product corrections route through the unrouted queue).
 */
import type { PoolClient } from 'pg';
import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { NotFoundError, ValidationError, ConflictError, ForbiddenError } from '@/lib/utils/errors';
import { assertActiveMembership } from './membership-guard';

interface ReallocationRow {
  id:                       string;
  payment_id:               string;
  from_group_id:            string;
  from_member_id:           string | null;
  from_domain_id:           string | null;
  to_group_id:              string;
  to_member_id:             string | null;
  to_group_membership_id:   string | null;
  reason:                   string;
  initiated_by:             string;
  status:                   string;
}

export const reallocationsService = {

  /**
   * Open a correction for a contribution posted to the wrong member.
   * Executes immediately when the amount is at or below the group's
   * maker-checker threshold; otherwise parks in 'pending_approval'.
   */
  async initiate(
    ctx:  TenantContext,
    data: { contributionId: string; toMemberId: string; reason: string },
  ) {
    return withTransaction(ctx, async (client) => {
      // Target must hold an active membership in this group (§5/§6a).
      const { membershipId: toMembershipId } =
        await assertActiveMembership(client, ctx.groupId, data.toMemberId);

      // Source contribution: completed, M-Pesa-linked, this group.
      const { rows: [contrib] } = await client.query<{
        id: string; group_id: string; member_id: string;
        group_membership_id: string; amount: string; status: string;
        payment_id: string | null; mpesa_receipt_number: string | null;
        journal_entry_id: string | null;
      }>(
        `SELECT id, group_id, member_id, group_membership_id, amount, status,
                payment_id, mpesa_receipt_number, journal_entry_id
         FROM   contributions
         WHERE  id = $1 AND group_id = $2
         FOR UPDATE`,
        [data.contributionId, ctx.groupId],
      );
      if (!contrib) throw new NotFoundError('Contribution', data.contributionId);
      if (contrib.status !== 'completed') {
        throw new ValidationError(`Only completed contributions can be reallocated (status: ${contrib.status})`);
      }
      if (!contrib.payment_id) {
        throw new ValidationError(
          'This contribution has no linked payment — correct cash/manual entries via the contribution edit flow',
        );
      }
      if (contrib.member_id === data.toMemberId) {
        throw new ValidationError('The contribution already belongs to that member');
      }

      // Spine row must still be in 'allocated'.
      const { rows: [payment] } = await client.query<{ id: string; allocation_status: string }>(
        `SELECT id, allocation_status FROM payments WHERE id = $1 FOR UPDATE`,
        [contrib.payment_id],
      );
      if (!payment || payment.allocation_status !== 'allocated') {
        throw new ConflictError(
          `Payment is not in an allocatable state (${payment?.allocation_status ?? 'missing'})`,
        );
      }

      const { rows: [grp] } = await client.query<{ threshold: string }>(
        `SELECT reallocation_approval_threshold AS threshold FROM groups WHERE id = $1`,
        [ctx.groupId],
      );
      const needsApproval = parseFloat(contrib.amount) > parseFloat(grp.threshold);

      const { rows: [realloc] } = await client.query<ReallocationRow>(
        `INSERT INTO payment_reallocations
           (payment_id, from_group_id, from_member_id, from_product, from_domain_id,
            from_group_membership_id,
            to_group_id, to_member_id, to_product, to_group_membership_id,
            kind, reason, initiated_by, status)
         VALUES ($1, $2, $3, 'savings', $4, $5,
                 $2, $6, 'savings', $7,
                 'reallocation', $8, $9, $10)
         RETURNING *`,
        [
          contrib.payment_id, ctx.groupId, contrib.member_id, contrib.id,
          contrib.group_membership_id,
          data.toMemberId, toMembershipId,
          data.reason, ctx.userId,
          needsApproval ? 'pending_approval' : 'executed',
        ],
      );

      if (!needsApproval) {
        await executeReallocation(client, realloc, ctx.userId);
      }

      return { ...realloc, needsApproval };
    });
  },

  /** Second-officer approval (maker-checker) — approver ≠ initiator. */
  async approve(ctx: TenantContext, id: string) {
    return withTransaction(ctx, async (client) => {
      const { rows: [realloc] } = await client.query<ReallocationRow>(
        `SELECT * FROM payment_reallocations
         WHERE  id = $1 AND from_group_id = $2 AND status = 'pending_approval'
         FOR UPDATE`,
        [id, ctx.groupId],
      );
      if (!realloc) throw new NotFoundError('Pending reallocation', id);
      if (realloc.initiated_by === ctx.userId) {
        throw new ForbiddenError('Maker-checker: the initiator cannot approve their own reallocation');
      }

      const { rows: [updated] } = await client.query<ReallocationRow>(
        `UPDATE payment_reallocations
         SET    status = 'executed', approved_by = $2, approved_at = NOW()
         WHERE  id = $1
         RETURNING *`,
        [id, ctx.userId],
      );
      await executeReallocation(client, updated, ctx.userId);
      return updated;
    });
  },

  /** Reject (or withdraw) a pending correction. */
  async reject(ctx: TenantContext, id: string, reason: string) {
    return withTransaction(ctx, async (client) => {
      const { rows: [updated] } = await client.query<ReallocationRow>(
        `UPDATE payment_reallocations
         SET    status = 'rejected', rejected_by = $2, rejected_at = NOW(), rejection_reason = $3
         WHERE  id = $1 AND from_group_id = $4 AND status = 'pending_approval'
         RETURNING *`,
        [id, ctx.userId, reason, ctx.groupId],
      );
      if (!updated) throw new NotFoundError('Pending reallocation', id);
      return updated;
    });
  },

  async list(ctx: TenantContext, params: { page: number; limit: number; status?: string }) {
    return withDb(ctx, async (client) => {
      const conds: string[] = ['pr.from_group_id = $1'];
      const vals: unknown[] = [ctx.groupId];
      let i = 2;
      if (params.status) { conds.push(`pr.status = $${i++}`); vals.push(params.status); }
      const where  = conds.join(' AND ');
      const offset = (params.page - 1) * params.limit;

      const { rows: [{ count }] } = await client.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM payment_reallocations pr WHERE ${where}`, vals,
      );
      const { rows } = await client.query(
        `SELECT pr.*,
                p.mpesa_receipt_number, p.amount,
                fm.first_name || ' ' || fm.last_name AS from_member_name,
                tm.first_name || ' ' || tm.last_name AS to_member_name,
                im.first_name || ' ' || im.last_name AS initiated_by_name,
                am.first_name || ' ' || am.last_name AS approved_by_name
         FROM   payment_reallocations pr
         JOIN   payments p  ON p.id  = pr.payment_id
         LEFT JOIN members fm ON fm.id = pr.from_member_id
         LEFT JOIN members tm ON tm.id = pr.to_member_id
         LEFT JOIN members im ON im.id = pr.initiated_by
         LEFT JOIN members am ON am.id = pr.approved_by
         WHERE  ${where}
         ORDER  BY pr.created_at DESC
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
 * Execute a correction: void original → contra journal → new contribution →
 * mirrored journal → spine transition + events. Runs inside the caller's
 * transaction; any failure rolls the whole correction back.
 */
async function executeReallocation(
  client:  PoolClient,
  realloc: ReallocationRow,
  actorId: string,
): Promise<void> {
  // 1. Void the original row. The status latch makes double-execution
  //    impossible even if two approvals raced past the FOR UPDATE.
  const { rows: [original] } = await client.query<{
    id: string; group_id: string; member_id: string; group_membership_id: string;
    amount: string; contribution_date: Date; payment_method: string | null;
    mpesa_receipt_number: string | null; journal_entry_id: string | null;
  }>(
    `UPDATE contributions
     SET    status = 'cancelled',
            notes  = COALESCE(notes || ' ', '') || '[reallocated ' || $2 || ']'
     WHERE  id = $1 AND status = 'completed'
     RETURNING id, group_id, member_id, group_membership_id, amount,
               contribution_date, payment_method, mpesa_receipt_number, journal_entry_id`,
    [realloc.from_domain_id, realloc.id],
  );
  if (!original) {
    throw new ConflictError('Original contribution is no longer in a reallocatable state');
  }

  // 2 + 4. Contra journal (swap debit/credit) and mirrored journal for the
  // new membership — both derived from the original entry so split-rule
  // allocations are reversed and re-posted exactly. Skipped when the
  // original was posted without a journal (missing chart) — parity.
  let contraJeId: string | null = null;
  let newJeId:    string | null = null;
  if (original.journal_entry_id) {
    contraJeId = await mirrorJournal(client, {
      sourceJeId:   original.journal_entry_id,
      groupId:      original.group_id,
      description:  `Reallocation contra — ${realloc.id}`,
      actorId,
      memberId:     original.member_id,
      membershipId: original.group_membership_id,
      swap:         true,
    });
    newJeId = await mirrorJournal(client, {
      sourceJeId:   original.journal_entry_id,
      groupId:      original.group_id,
      description:  `Reallocation repost — ${realloc.id}`,
      actorId,
      memberId:     realloc.to_member_id!,
      membershipId: realloc.to_group_membership_id!,
      swap:         false,
    });
  }

  // 3. Corrected contribution. Receipt + payment_id remain on the voided
  //    original (their uniques are the exactly-once guarantee, §6c);
  //    to_domain_id below carries the payment → corrected-row linkage.
  const { rows: [corrected] } = await client.query<{ id: string }>(
    `INSERT INTO contributions
       (group_id, member_id, group_membership_id, amount, contribution_date,
        status, payment_method, notes, recorded_by, journal_entry_id)
     VALUES ($1, $2, $3, $4, $5, 'completed', $6, $7, $8, $9)
     RETURNING id`,
    [
      original.group_id, realloc.to_member_id, realloc.to_group_membership_id,
      original.amount, original.contribution_date, original.payment_method,
      `Reallocated from receipt ${original.mpesa_receipt_number ?? 'n/a'} (reallocation ${realloc.id})`,
      actorId, newJeId,
    ],
  );

  // 5. Spine transition + event chain (§11).
  await client.query(
    `UPDATE payments SET allocation_status = 'reallocated'
     WHERE  id = $1 AND allocation_status = 'allocated'`,
    [realloc.payment_id],
  );
  await client.query(
    `INSERT INTO payment_events (payment_id, event, actor, detail)
     VALUES ($1, 'reallocated', $2, $3::jsonb)`,
    [realloc.payment_id, actorId, JSON.stringify({
      reallocationId: realloc.id,
      fromMemberId:   realloc.from_member_id,
      toMemberId:     realloc.to_member_id,
      fromContributionId: original.id,
      toContributionId:   corrected.id,
    })],
  );
  await client.query(
    `INSERT INTO event_outbox (event_type, aggregate_id, payload)
     VALUES ('payment.reallocated', $1, $2::jsonb)`,
    [realloc.payment_id, JSON.stringify({ reallocationId: realloc.id })],
  );

  await client.query(
    `UPDATE payment_reallocations
     SET    executed_at = NOW(), to_domain_id = $2,
            reversal_journal_entry_id = $3, new_journal_entry_id = $4
     WHERE  id = $1`,
    [realloc.id, corrected.id, contraJeId, newJeId],
  );
}

/**
 * Copy a journal entry's lines onto a new posted entry — verbatim, or with
 * debit/credit swapped for the contra leg. Attribution (§6e) points at the
 * given member/membership; posted_via='user' with the acting officer.
 */
async function mirrorJournal(
  client: PoolClient,
  args: {
    sourceJeId: string; groupId: string; description: string; actorId: string;
    memberId: string; membershipId: string; swap: boolean;
  },
): Promise<string> {
  const { rows: [je] } = await client.query<{ id: string }>(
    `INSERT INTO journal_entries
       (group_id, entry_date, reference, description, status, created_by, posted_at,
        is_test, member_id, group_membership_id)
     SELECT group_id, CURRENT_DATE, reference, $2, 'posted', $3, NOW(),
            is_test, $4, $5
     FROM   journal_entries WHERE id = $1
     RETURNING id`,
    [args.sourceJeId, args.description, args.actorId, args.memberId, args.membershipId],
  );
  // entry_date is the journal_lines partition key — supplied directly as
  // CURRENT_DATE, matching the new entry's own date above (this mirrored
  // entry is deliberately dated today, not the original entry's date; a
  // BEFORE INSERT trigger deriving it after Postgres has already routed the
  // row to a partition is unsupported).
  await client.query(
    `INSERT INTO journal_lines (group_id, journal_entry_id, account_id, debit, credit, description, entry_date)
     SELECT group_id, $2, account_id,
            CASE WHEN $3 THEN credit ELSE debit  END,
            CASE WHEN $3 THEN debit  ELSE credit END,
            description, CURRENT_DATE
     FROM   journal_lines WHERE journal_entry_id = $1`,
    [args.sourceJeId, je.id, args.swap],
  );
  return je.id;
}
