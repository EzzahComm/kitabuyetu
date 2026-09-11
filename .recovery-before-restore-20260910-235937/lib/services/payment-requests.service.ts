/**
 * Payment requests (payment architecture §3.6) — purpose linkage for STK and
 * PayBill allocation. Requests are an OPTIMIZATION, never a dependency:
 * incoming payments always allocate even with no request (tiers A7/A8).
 *
 * Lifecycle: open → fulfilled | expired | cancelled.
 * Fulfilment is latched by `status='open'` in the UPDATE plus
 * UNIQUE(fulfilled_by_payment), so concurrent callbacks cannot double-fulfil.
 */
import type { PoolClient } from 'pg';
import { withDb, withTransaction, withAdminDb, type TenantContext } from '@/lib/db';
import { NotFoundError } from '@/lib/utils/errors';
import { assertActiveMembership } from './membership-guard';
import type { OpenPaymentRequest, PaymentProduct } from '@/lib/utils/allocation-engine';

export interface CreatePaymentRequestInput {
  memberId:  string;
  product:   PaymentProduct;
  amount:    number;
  entityId?: string | null;
  /** Hours until expiry; omit for no expiry. */
  expiresInHours?: number | null;
}

export const paymentRequestsService = {

  async create(ctx: TenantContext, data: CreatePaymentRequestInput) {
    return withTransaction(ctx, async (client) => {
      const { membershipId } = await assertActiveMembership(client, ctx.groupId, data.memberId);
      const { rows } = await client.query(
        `INSERT INTO payment_requests
           (group_id, group_membership_id, member_id, product, entity_id,
            amount, expires_at, created_by)
         VALUES ($1,$2,$3,$4::payment_product,$5,$6,
                 CASE WHEN $7::int IS NULL THEN NULL
                      ELSE NOW() + make_interval(hours => $7::int) END,
                 $8)
         RETURNING *`,
        [
          ctx.groupId, membershipId, data.memberId, data.product,
          data.entityId ?? null, data.amount.toFixed(2),
          data.expiresInHours ?? null, ctx.userId,
        ],
      );
      return rows[0];
    });
  },

  async list(ctx: TenantContext, params: { page: number; limit: number; status?: string; memberId?: string }) {
    return withDb(ctx, async (client) => {
      const conds: string[] = ['pr.group_id = $1'];
      const vals: unknown[] = [ctx.groupId];
      let i = 2;
      if (params.status)   { conds.push(`pr.status = $${i++}`);    vals.push(params.status); }
      if (params.memberId) { conds.push(`pr.member_id = $${i++}`); vals.push(params.memberId); }

      const where  = conds.join(' AND ');
      const offset = (params.page - 1) * params.limit;

      const { rows: [{ count }] } = await client.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM payment_requests pr WHERE ${where}`, vals,
      );
      const { rows } = await client.query(
        `SELECT pr.*, m.first_name || ' ' || m.last_name AS member_name,
                gm.membership_no
         FROM payment_requests pr
         JOIN members m        ON m.id  = pr.member_id
         JOIN group_members gm ON gm.id = pr.group_membership_id
         WHERE ${where}
         ORDER BY pr.created_at DESC
         LIMIT $${i} OFFSET $${i + 1}`,
        [...vals, params.limit, offset],
      );
      return {
        items: rows, total: parseInt(count, 10), page: params.page,
        pageSize: params.limit, totalPages: Math.ceil(parseInt(count, 10) / params.limit),
      };
    });
  },

  async cancel(ctx: TenantContext, id: string) {
    return withTransaction(ctx, async (client) => {
      const { rowCount } = await client.query(
        `UPDATE payment_requests SET status = 'cancelled'
         WHERE id = $1 AND group_id = $2 AND status = 'open'`,
        [id, ctx.groupId],
      );
      if (!rowCount) throw new NotFoundError('Open payment request', id);
    });
  },
};

// ─── Allocation-engine + job plumbing (admin context) ───────────────────────

/**
 * Open, unexpired requests for a membership — the A2/A4/A5 inputs.
 * Expiry filtering here implements A6 even between expiry-job runs.
 */
export async function findOpenRequests(
  db: PoolClient,
  membershipId: string,
): Promise<OpenPaymentRequest[]> {
  const { rows } = await db.query<{
    id: string; product: PaymentProduct; entity_id: string | null;
    amount: string; created_at: Date;
  }>(
    `SELECT id, product, entity_id, amount, created_at
     FROM   payment_requests
     WHERE  group_membership_id = $1
       AND  status = 'open'
       AND  (expires_at IS NULL OR expires_at > NOW())
     ORDER  BY created_at`,
    [membershipId],
  );
  return rows.map((r) => ({
    id: r.id, product: r.product, entityId: r.entity_id,
    amount: parseFloat(r.amount), createdAt: new Date(r.created_at),
  }));
}

/** Latch a request as fulfilled by a payment. No-op if already closed. */
export async function fulfilRequest(
  db: PoolClient,
  requestId: string,
  paymentId: string | null,
): Promise<void> {
  await db.query(
    `UPDATE payment_requests
     SET    status = 'fulfilled', fulfilled_by_payment = $2
     WHERE  id = $1 AND status = 'open'`,
    [requestId, paymentId],
  );
}

/** Expiry sweep (job: payment_requests_expire) — feeds decision rule A6. */
export async function expireDueRequests(): Promise<{ expired: number }> {
  return withAdminDb(async (db) => {
    const { rowCount } = await db.query(
      `UPDATE payment_requests SET status = 'expired'
       WHERE  status = 'open' AND expires_at IS NOT NULL AND expires_at <= NOW()`,
    );
    return { expired: rowCount ?? 0 };
  });
}
