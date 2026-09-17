/**
 * Fines issuance and tracking (Phase 3, migration 180).
 *
 * fine-policy.service.ts is an advisory tariff schedule only — its own header
 * says "nothing auto-charges them". This service is what actually ISSUES a
 * fine against a member (reading a suggested amount from that schedule, but
 * allowing an officer override with a reason), tracks its lifecycle
 * (issued -> paid/waived/cancelled), and links to the existing
 * payment_requests mechanism for collection instead of reinventing it.
 *
 * Architecture mirrors welfare.service.ts closely: TenantContext,
 * withDb/withTransaction, an atomic audit_logs insert (old_values/new_values)
 * in the same transaction as every write, and postTemplatedJournal for the
 * one write that actually recognizes revenue (a fine getting paid).
 *
 * markPaid is an explicit officer confirmation, not a payment_requests
 * webhook hook: 'fine' has been a payment_requests.product enum value since
 * migration 059, but dispatchProduct (mpesa-allocation.service.ts) has no
 * case for it — a 'fine' payment_request can never be auto-fulfilled by the
 * M-Pesa engine today (it falls through to the same manual-confirmation path
 * 'share' purchases already use, per that switch's own comment). Gating
 * markPaid on the linked request reaching 'fulfilled' would therefore strand
 * every fine that goes through initiateCollection, since nothing can ever
 * make that transition happen automatically yet. An officer confirming
 * payment directly (cash collected at a meeting, or an M-Pesa payment the
 * officer has separately reconciled) is the same manual pattern already
 * accepted elsewhere in this codebase, not a shortcut invented for fines.
 */
import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/utils/errors';
import { assertActiveMembership } from './membership-guard';
import { finePolicyService } from './fine-policy.service';
import { paymentRequestsService } from './payment-requests.service';
import { postTemplatedJournal } from './posting-templates.service';
import type {
  IssueFineInput, WaiveFineInput, CancelFineInput, FineQueryInput,
} from '@/lib/validators/fine.schema';

const FINE_SELECT = `
  SELECT f.*,
         m.first_name  || ' ' || m.last_name  AS member_name,
         m.phone                              AS member_phone,
         ib.first_name || ' ' || ib.last_name AS issued_by_name,
         wb.first_name || ' ' || wb.last_name AS waived_by_name,
         cb.first_name || ' ' || cb.last_name AS cancelled_by_name
  FROM   fines f
  JOIN   members m   ON m.id  = f.member_id
  LEFT JOIN members ib ON ib.id = f.issued_by
  LEFT JOIN members wb ON wb.id = f.waived_by
  LEFT JOIN members cb ON cb.id = f.cancelled_by
`;

export const finesService = {

  async list(ctx: TenantContext, params: FineQueryInput) {
    return withDb(ctx, async (client) => {
      const offset = (params.page - 1) * params.limit;
      const conditions: string[] = ['f.group_id = $1'];
      const args: unknown[] = [ctx.groupId];
      let i = 2;

      if (params.status)   { conditions.push(`f.status = $${i++}`);    args.push(params.status); }
      if (params.memberId) { conditions.push(`f.member_id = $${i++}`); args.push(params.memberId); }

      const where = conditions.join(' AND ');

      const { rows: items } = await client.query(
        `${FINE_SELECT}
         WHERE  ${where}
         ORDER  BY f.issued_at DESC
         LIMIT  $${i++} OFFSET $${i++}`,
        [...args, params.limit, offset],
      );
      const { rows: [{ count }] } = await client.query(
        `SELECT COUNT(*) FROM fines f WHERE ${where}`,
        args,
      );
      return {
        items, total: Number(count),
        totalPages: Math.ceil(Number(count) / params.limit),
        page: params.page, pageSize: params.limit,
      };
    });
  },

  async getById(ctx: TenantContext, id: string) {
    return withDb(ctx, async (client) => {
      const { rows } = await client.query(
        `${FINE_SELECT} WHERE f.id = $1 AND f.group_id = $2`,
        [id, ctx.groupId],
      );
      if (!rows[0]) throw new NotFoundError('Fine', id);
      return rows[0];
    });
  },

  async issue(ctx: TenantContext, input: IssueFineInput) {
    return withTransaction(ctx, async (client) => {
      // The fined member must hold an active membership in THIS group (audit
      // H-1); its id is stamped on the row (§6a), same as every other
      // financial write path.
      const { membershipId } = await assertActiveMembership(client, ctx.groupId, input.memberId);

      let amount = input.amount;
      if (amount === undefined) {
        const { schedule } = await finePolicyService.getGroupSchedule(ctx);
        const suggested = schedule[input.fineType];
        if (suggested === undefined) {
          throw new ValidationError(
            `No tariff amount for offence '${input.fineType}' and none was supplied — ` +
            `add it to the fine schedule (PUT /api/v1/fines/policy) or pass an explicit amount`,
          );
        }
        amount = suggested;
      }
      // Zero is a legal tariff entry (fine-policy.service.ts's validateSchedule
      // allows it, meaning "no fine for this offence") but not a legal ISSUED
      // fine — there would be nothing to track or collect.
      if (!(amount > 0)) {
        throw new ValidationError('Fine amount must be greater than zero');
      }

      const { rows } = await client.query(
        `INSERT INTO fines
           (group_id, member_id, group_membership_id, fine_type, amount, reason,
            status, issued_by, issued_at)
         VALUES ($1,$2,$3,$4,$5,$6,'issued',$7,now())
         RETURNING *`,
        [
          ctx.groupId, input.memberId, membershipId, input.fineType,
          amount.toFixed(2), input.reason ?? null, ctx.userId,
        ],
      );
      const fine = rows[0];

      // Record audit log entry (atomic with the fine insert)
      await client.query(
        `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          ctx.groupId, ctx.userId, 'fine.issue', 'fine', fine.id, null,
          JSON.stringify({
            member_id: input.memberId, fine_type: input.fineType,
            amount, status: 'issued',
          }),
        ],
      );

      return fine;
    });
  },

  async waive(ctx: TenantContext, id: string, data: WaiveFineInput) {
    return withTransaction(ctx, async (client) => {
      const { rows: [fine] } = await client.query(
        'SELECT * FROM fines WHERE id=$1 AND group_id=$2',
        [id, ctx.groupId],
      );
      if (!fine) throw new NotFoundError('Fine', id);
      if (fine.status !== 'issued') {
        throw new ValidationError(`Cannot waive a fine with status '${fine.status}'`);
      }

      const { rows } = await client.query(
        `UPDATE fines SET
           status='waived', waived_by=$1, waived_at=now(), waived_reason=$2, updated_at=now()
         WHERE id=$3 AND group_id=$4 RETURNING *`,
        [ctx.userId, data.reason, id, ctx.groupId],
      );

      // Record audit log entry for the waiver (atomic with the update)
      await client.query(
        `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          ctx.groupId, ctx.userId, 'fine.waive', 'fine', id,
          JSON.stringify({ status: 'issued' }),
          JSON.stringify({ status: 'waived', waived_reason: data.reason }),
        ],
      );

      return rows[0];
    });
  },

  async cancel(ctx: TenantContext, id: string, data: CancelFineInput) {
    return withTransaction(ctx, async (client) => {
      const { rows: [fine] } = await client.query(
        'SELECT * FROM fines WHERE id=$1 AND group_id=$2',
        [id, ctx.groupId],
      );
      if (!fine) throw new NotFoundError('Fine', id);
      // Administrative correction ("issued in error") — only before any
      // money has moved. Once paid/waived this must stay an honest record
      // rather than being erased retroactively.
      if (fine.status !== 'issued') {
        throw new ValidationError(`Cannot cancel a fine with status '${fine.status}'`);
      }

      if (fine.payment_request_id) {
        const { rows: [request] } = await client.query(
          'SELECT status FROM payment_requests WHERE id=$1',
          [fine.payment_request_id],
        );
        if (request?.status === 'fulfilled') {
          throw new ValidationError(
            'This fine has already been collected via its linked payment request — mark it paid instead of cancelling',
          );
        }
      }

      const { rows } = await client.query(
        `UPDATE fines SET
           status='cancelled', cancelled_by=$1, cancelled_at=now(), cancel_reason=$2, updated_at=now()
         WHERE id=$3 AND group_id=$4 RETURNING *`,
        [ctx.userId, data.reason, id, ctx.groupId],
      );

      // Record audit log entry for the cancellation (atomic with the update)
      await client.query(
        `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          ctx.groupId, ctx.userId, 'fine.cancel', 'fine', id,
          JSON.stringify({ status: 'issued' }),
          JSON.stringify({ status: 'cancelled', cancel_reason: data.reason }),
        ],
      );

      // Best-effort: an open request against a now-cancelled fine would
      // otherwise linger unpayable forever (nothing else will ever close
      // it). Ignore failure — paymentRequestsService.cancel throws if it is
      // no longer 'open' (already fulfilled/expired/cancelled), which is
      // fine here: there's nothing left to tidy up in that case.
      if (fine.payment_request_id) {
        await paymentRequestsService.cancel(ctx, fine.payment_request_id).catch(() => {});
      }

      return rows[0];
    });
  },

  async initiateCollection(ctx: TenantContext, id: string) {
    const fine = await withDb(ctx, async (client) => {
      const { rows: [f] } = await client.query(
        'SELECT * FROM fines WHERE id=$1 AND group_id=$2',
        [id, ctx.groupId],
      );
      if (!f) throw new NotFoundError('Fine', id);
      if (f.status !== 'issued') {
        throw new ValidationError(`Cannot initiate collection for a fine with status '${f.status}'`);
      }
      if (f.payment_request_id) {
        throw new ValidationError('Collection has already been initiated for this fine');
      }
      return f;
    });

    // Reuses the existing payment-request mechanism (STK/PayBill purpose
    // linkage, payment-requests.service.ts) rather than inventing a parallel
    // collection path. That service owns its own transaction (a top-level
    // entry point, not a client-taking primitive like postTemplatedJournal),
    // so this call is deliberately outside the transaction that links the
    // result back onto the fine below.
    const paymentRequest = await paymentRequestsService.create(ctx, {
      memberId: fine.member_id,
      product:  'fine',
      amount:   Number(fine.amount),
      entityId: fine.id,
    });

    try {
      return await withTransaction(ctx, async (client) => {
        // Re-check under lock: guards the (rare) race of two concurrent
        // initiateCollection calls both passing the read-check above.
        const { rows: [f] } = await client.query(
          'SELECT * FROM fines WHERE id=$1 AND group_id=$2 FOR UPDATE',
          [id, ctx.groupId],
        );
        if (!f) throw new NotFoundError('Fine', id);
        if (f.status !== 'issued' || f.payment_request_id) {
          throw new ValidationError(
            `Fine status changed to '${f.status}' while initiating collection — try again`,
          );
        }

        const { rows } = await client.query(
          `UPDATE fines SET payment_request_id=$1, updated_at=now()
           WHERE id=$2 AND group_id=$3 RETURNING *`,
          [paymentRequest.id, id, ctx.groupId],
        );

        // Record audit log entry (atomic with the update)
        await client.query(
          `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            ctx.groupId, ctx.userId, 'fine.initiateCollection', 'fine', id,
            JSON.stringify({ payment_request_id: null }),
            JSON.stringify({ payment_request_id: paymentRequest.id }),
          ],
        );

        return rows[0];
      });
    } catch (err) {
      // The fine-side link failed (race) — don't leave an orphaned open
      // request nobody will ever pay against.
      await paymentRequestsService.cancel(ctx, paymentRequest.id).catch(() => {});
      throw err;
    }
  },

  /**
   * Marks a fine paid and posts the GL entry — a fine actually collected is
   * realized revenue for the group (postTemplatedJournal('fine_collection'),
   * see posting-templates.service.ts, rather than an ad-hoc journal insert).
   *
   * Deliberately does not require the linked payment_request (if any) to be
   * 'fulfilled' first — see this file's header for why that gate would be
   * unsatisfiable today. Cash collected with no payment_request at all is
   * equally valid, mirroring welfare.disburse()'s 'cash' path.
   */
  async markPaid(ctx: TenantContext, id: string) {
    return withTransaction(ctx, async (client) => {
      const { rows: [fine] } = await client.query(
        'SELECT * FROM fines WHERE id=$1 AND group_id=$2 FOR UPDATE',
        [id, ctx.groupId],
      );
      if (!fine) throw new NotFoundError('Fine', id);
      if (fine.status !== 'issued') {
        throw new ValidationError(`Cannot mark paid a fine with status '${fine.status}'`);
      }

      const { rows } = await client.query(
        `UPDATE fines SET status='paid', paid_at=now(), updated_at=now()
         WHERE id=$1 AND group_id=$2 RETURNING *`,
        [id, ctx.groupId],
      );

      // Record audit log entry (atomic with the update)
      await client.query(
        `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          ctx.groupId, ctx.userId, 'fine.markPaid', 'fine', id,
          JSON.stringify({ status: 'issued' }),
          JSON.stringify({ status: 'paid' }),
        ],
      );

      // ACCOUNTING_ARCHITECTURE_AUDIT.md §7 pattern: a real cash inflow with
      // previously zero GL trace.
      await postTemplatedJournal(
        client, ctx.groupId, ctx.userId, 'fine_collection',
        `Fine collected — ${fine.fine_type} (fine ${id})`,
        { amount: Number(fine.amount) },
        { reference: id, memberId: fine.member_id, groupMembershipId: fine.group_membership_id },
      );

      return rows[0];
    });
  },
};
