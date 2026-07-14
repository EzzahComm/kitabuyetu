import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { NotFoundError, ValidationError, ForbiddenError } from '@/lib/utils/errors';
import { assertActiveMembership } from './membership-guard';
import { z } from 'zod';

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const CreateWelfareRequestSchema = z.object({
  requestType:     z.enum(['funeral','hospital','emergency','education','maternity','bereavement','disability','other']),
  title:           z.string().min(5).max(255),
  description:     z.string().optional(),
  amountRequested: z.coerce.number().positive(),
  priority:        z.enum(['low','normal','high','urgent']).default('normal'),
  notes:           z.string().optional(),
});

export const ReviewWelfareRequestSchema = z.object({
  action:          z.enum(['approve','reject']),
  amountApproved:  z.coerce.number().positive().optional(),
  rejectionReason: z.string().optional(),
  notes:           z.string().optional(),
});

export const DisburseWelfareSchema = z.object({
  paymentMethod:      z.enum(['mpesa','cash','bank_transfer']),
  mpesaReceiptNumber: z.string().optional(),
  amountDisbursed:    z.coerce.number().positive(),
  notes:              z.string().optional(),
});

export const WelfareQuerySchema = z.object({
  page:    z.coerce.number().int().positive().default(1),
  limit:   z.coerce.number().int().positive().max(100).default(20),
  status:  z.string().optional(),
  memberId: z.string().uuid().optional(),
});

export const RecordWelfarePoolSchema = z.object({
  memberId:           z.string().uuid(),
  amount:             z.coerce.number().positive(),
  contributionType:   z.enum(['regular','emergency_levy','special','bereavement_levy']).default('regular'),
  paymentMethod:      z.enum(['mpesa','cash','bank_transfer']).optional(),
  mpesaReceiptNumber: z.string().optional(),
  periodMonth:        z.coerce.number().int().min(1).max(12).optional(),
  periodYear:         z.coerce.number().int().min(2020).optional(),
  notes:              z.string().optional(),
});

export type CreateWelfareRequestInput = z.infer<typeof CreateWelfareRequestSchema>;
export type ReviewWelfareRequestInput = z.infer<typeof ReviewWelfareRequestSchema>;
export type DisburseWelfareInput      = z.infer<typeof DisburseWelfareSchema>;
export type WelfareQueryInput         = z.infer<typeof WelfareQuerySchema>;
export type RecordWelfarePoolInput    = z.infer<typeof RecordWelfarePoolSchema>;

// ─── Service ──────────────────────────────────────────────────────────────────

export const welfareService = {

  async listRequests(ctx: TenantContext, params: WelfareQueryInput) {
    return withDb(ctx, async (client) => {
      const offset = (params.page - 1) * params.limit;
      const conditions: string[] = ['wr.group_id = $1'];
      const args: unknown[] = [ctx.groupId];
      let i = 2;

      if (params.status) { conditions.push(`wr.status = $${i++}`); args.push(params.status); }
      if (params.memberId) { conditions.push(`wr.member_id = $${i++}`); args.push(params.memberId); }

      const where = conditions.join(' AND ');

      const { rows: items } = await client.query(
        `SELECT wr.*,
                m.first_name || ' ' || m.last_name AS member_name,
                m.phone AS member_phone,
                ab.first_name || ' ' || ab.last_name AS approved_by_name,
                db.first_name || ' ' || db.last_name AS disbursed_by_name
         FROM   welfare_requests wr
         JOIN   members m  ON m.id = wr.member_id
         LEFT JOIN members ab ON ab.id = wr.approved_by
         LEFT JOIN members db ON db.id = wr.disbursed_by
         WHERE  ${where}
         ORDER  BY wr.created_at DESC
         LIMIT  $${i++} OFFSET $${i++}`,
        [...args, params.limit, offset],
      );
      const { rows: [{ count }] } = await client.query(
        `SELECT COUNT(*) FROM welfare_requests wr WHERE ${where}`,
        args,
      );
      return { items, total: Number(count), totalPages: Math.ceil(Number(count) / params.limit), page: params.page };
    });
  },

  async getById(ctx: TenantContext, id: string) {
    return withDb(ctx, async (client) => {
      const { rows } = await client.query(
        `SELECT wr.*,
                m.first_name || ' ' || m.last_name AS member_name,
                m.phone AS member_phone,
                rv.first_name || ' ' || rv.last_name AS reviewed_by_name,
                ab.first_name || ' ' || ab.last_name AS approved_by_name,
                rb.first_name || ' ' || rb.last_name AS rejected_by_name,
                db.first_name || ' ' || db.last_name AS disbursed_by_name
         FROM   welfare_requests wr
         JOIN   members m   ON m.id = wr.member_id
         LEFT JOIN members rv ON rv.id = wr.reviewed_by
         LEFT JOIN members ab ON ab.id = wr.approved_by
         LEFT JOIN members rb ON rb.id = wr.rejected_by
         LEFT JOIN members db ON db.id = wr.disbursed_by
         WHERE  wr.id = $1 AND wr.group_id = $2`,
        [id, ctx.groupId],
      );
      if (!rows[0]) throw new NotFoundError('Welfare request', id);
      return rows[0];
    });
  },

  async createRequest(ctx: TenantContext, data: CreateWelfareRequestInput) {
    return withTransaction(ctx, async (client) => {
      // Requester must hold an active membership in THIS group (audit H-1);
      // its id is stamped on the row (§6a).
      const { membershipId } = await assertActiveMembership(client, ctx.groupId, ctx.userId);

      const { rows } = await client.query(
        `INSERT INTO welfare_requests
           (group_id, member_id, group_membership_id, request_type, title, description,
            amount_requested, priority, notes, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')
         RETURNING *`,
        [ctx.groupId, ctx.userId, membershipId, data.requestType, data.title,
         data.description ?? null, data.amountRequested, data.priority, data.notes ?? null],
      );
      return rows[0];
    });
  },

  async reviewRequest(ctx: TenantContext, id: string, data: ReviewWelfareRequestInput) {
    return withTransaction(ctx, async (client) => {
      const { rows: [req] } = await client.query(
        'SELECT * FROM welfare_requests WHERE id=$1 AND group_id=$2',
        [id, ctx.groupId],
      );
      if (!req) throw new NotFoundError('Welfare request', id);
      if (req.status !== 'pending' && req.status !== 'under_review') {
        throw new ValidationError(`Cannot review a request with status '${req.status}'`);
      }

      if (data.action === 'approve') {
        const { rows } = await client.query(
          `UPDATE welfare_requests SET
             status='approved', amount_approved=$1, approved_by=$2,
             approved_at=now(), notes=COALESCE($3, notes), updated_at=now()
           WHERE id=$4 AND group_id=$5 RETURNING *`,
          [data.amountApproved ?? req.amount_requested, ctx.userId, data.notes ?? null, id, ctx.groupId],
        );
        return rows[0];
      } else {
        if (!data.rejectionReason) throw new ValidationError('Rejection reason is required');
        const { rows } = await client.query(
          `UPDATE welfare_requests SET
             status='rejected', rejected_by=$1, rejected_at=now(),
             rejection_reason=$2, notes=COALESCE($3, notes), updated_at=now()
           WHERE id=$4 AND group_id=$5 RETURNING *`,
          [ctx.userId, data.rejectionReason, data.notes ?? null, id, ctx.groupId],
        );
        return rows[0];
      }
    });
  },

  async disburse(ctx: TenantContext, id: string, data: DisburseWelfareInput) {
    return withTransaction(ctx, async (client) => {
      const { rows: [req] } = await client.query(
        'SELECT * FROM welfare_requests WHERE id=$1 AND group_id=$2',
        [id, ctx.groupId],
      );
      if (!req) throw new NotFoundError('Welfare request', id);
      if (req.status !== 'approved') {
        throw new ValidationError(`Cannot disburse a request with status '${req.status}'`);
      }
      const { rows } = await client.query(
        `UPDATE welfare_requests SET
           status='disbursed', amount_disbursed=$1, disbursed_by=$2, disbursed_at=now(),
           payment_method=$3, mpesa_receipt_number=$4, notes=COALESCE($5, notes), updated_at=now()
         WHERE id=$6 AND group_id=$7 RETURNING *`,
        [data.amountDisbursed, ctx.userId, data.paymentMethod,
         data.mpesaReceiptNumber ?? null, data.notes ?? null, id, ctx.groupId],
      );
      return rows[0];
    });
  },

  async getPoolSummary(ctx: TenantContext) {
    return withDb(ctx, async (client) => {
      const { rows: [pool] } = await client.query(
        `SELECT
           COALESCE(SUM(amount), 0)::DECIMAL AS total_collected,
           COUNT(*) AS total_contributions
         FROM welfare_pool_contributions WHERE group_id = $1`,
        [ctx.groupId],
      );
      const { rows: [disbursed] } = await client.query(
        `SELECT COALESCE(SUM(amount_disbursed), 0)::DECIMAL AS total_disbursed,
                COUNT(*) FILTER (WHERE status='pending')   AS pending_count,
                COUNT(*) FILTER (WHERE status='approved')  AS approved_count,
                COUNT(*) FILTER (WHERE status='disbursed') AS disbursed_count
         FROM welfare_requests WHERE group_id = $1`,
        [ctx.groupId],
      );
      return {
        totalCollected:    Number(pool.total_collected),
        totalContributions: Number(pool.total_contributions),
        totalDisbursed:    Number(disbursed.total_disbursed),
        balance:           Number(pool.total_collected) - Number(disbursed.total_disbursed),
        pendingCount:      Number(disbursed.pending_count),
        approvedCount:     Number(disbursed.approved_count),
        disbursedCount:    Number(disbursed.disbursed_count),
      };
    });
  },

  async recordPoolContribution(ctx: TenantContext, data: RecordWelfarePoolInput) {
    return withTransaction(ctx, async (client) => {
      // The target member must hold an active membership in THIS group (audit
      // H-1); its id is stamped on the row (§6a).
      const { membershipId } = await assertActiveMembership(client, ctx.groupId, data.memberId);

      const { rows } = await client.query(
        `INSERT INTO welfare_pool_contributions
           (group_id, member_id, group_membership_id, amount, contribution_type, payment_method,
            mpesa_receipt_number, period_month, period_year, recorded_by, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [ctx.groupId, data.memberId, membershipId, data.amount, data.contributionType,
         data.paymentMethod ?? null, data.mpesaReceiptNumber ?? null,
         data.periodMonth ?? null, data.periodYear ?? null,
         ctx.userId, data.notes ?? null],
      );
      return rows[0];
    });
  },

  async listPoolContributions(ctx: TenantContext, params: { page: number; limit: number }) {
    return withDb(ctx, async (client) => {
      const offset = (params.page - 1) * params.limit;
      const { rows: items } = await client.query(
        `SELECT wpc.*, m.first_name || ' ' || m.last_name AS member_name
         FROM welfare_pool_contributions wpc
         JOIN members m ON m.id = wpc.member_id
         WHERE wpc.group_id = $1
         ORDER BY wpc.created_at DESC
         LIMIT $2 OFFSET $3`,
        [ctx.groupId, params.limit, offset],
      );
      const { rows: [{ count }] } = await client.query(
        'SELECT COUNT(*) FROM welfare_pool_contributions WHERE group_id=$1',
        [ctx.groupId],
      );
      return { items, total: Number(count), totalPages: Math.ceil(Number(count) / params.limit) };
    });
  },
};
