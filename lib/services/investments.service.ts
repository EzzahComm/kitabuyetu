import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/utils/errors';
import { z } from 'zod';

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const CreateInvestmentSchema = z.object({
  name:                z.string().min(3).max(255),
  description:         z.string().optional(),
  investmentType:      z.enum(['real_estate','shares','bonds','fixed_deposit','business','land','treasury_bills','money_market','other']),
  principalAmount:     z.coerce.number().positive(),
  expectedReturnRate:  z.coerce.number().min(0).max(100).optional(),
  startDate:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  maturityDate:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  custodian:           z.string().optional(),
  registrationNumber:  z.string().optional(),
  location:            z.string().optional(),
  notes:               z.string().optional(),
});

export const UpdateInvestmentSchema = z.object({
  currentValue:       z.coerce.number().positive().optional(),
  status:             z.enum(['pending_approval','active','matured','liquidated','cancelled']).optional(),
  custodian:          z.string().optional(),
  notes:              z.string().optional(),
  liquidationValue:   z.coerce.number().positive().optional(),
});

export const RecordReturnSchema = z.object({
  returnType:    z.enum(['dividend','interest','capital_gain','rental_income','coupon','other']),
  amount:        z.coerce.number().positive(),
  returnDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  receiptNumber: z.string().optional(),
  notes:         z.string().optional(),
});

export const InvestmentQuerySchema = z.object({
  page:   z.coerce.number().int().positive().default(1),
  limit:  z.coerce.number().int().positive().max(100).default(20),
  status: z.string().optional(),
  type:   z.string().optional(),
});

export type CreateInvestmentInput  = z.infer<typeof CreateInvestmentSchema>;
export type UpdateInvestmentInput  = z.infer<typeof UpdateInvestmentSchema>;
export type RecordReturnInput      = z.infer<typeof RecordReturnSchema>;
export type InvestmentQueryInput   = z.infer<typeof InvestmentQuerySchema>;

// ─── Service ──────────────────────────────────────────────────────────────────

export const investmentsService = {

  async list(ctx: TenantContext, params: InvestmentQueryInput) {
    return withDb(ctx, async (client) => {
      const offset = (params.page - 1) * params.limit;
      const conditions: string[] = ['i.group_id = $1'];
      const args: unknown[] = [ctx.groupId];
      let p = 2;

      if (params.status) { conditions.push(`i.status = $${p++}`); args.push(params.status); }
      if (params.type)   { conditions.push(`i.investment_type = $${p++}`); args.push(params.type); }

      const where = conditions.join(' AND ');

      const { rows: items } = await client.query(
        `SELECT i.*,
                cb.first_name || ' ' || cb.last_name AS created_by_name,
                COALESCE((
                  SELECT SUM(amount) FROM investment_returns
                  WHERE investment_id = i.id
                ), 0) AS total_returns
         FROM   investments i
         JOIN   members cb ON cb.id = i.created_by
         WHERE  ${where}
         ORDER  BY i.created_at DESC
         LIMIT  $${p++} OFFSET $${p++}`,
        [...args, params.limit, offset],
      );
      const { rows: [{ count }] } = await client.query(
        `SELECT COUNT(*) FROM investments i WHERE ${where}`,
        args,
      );
      return { items, total: Number(count), totalPages: Math.ceil(Number(count) / params.limit), page: params.page };
    });
  },

  async getById(ctx: TenantContext, id: string) {
    return withDb(ctx, async (client) => {
      const { rows: [inv] } = await client.query(
        `SELECT i.*,
                cb.first_name || ' ' || cb.last_name AS created_by_name,
                ab.first_name || ' ' || ab.last_name AS approved_by_name
         FROM   investments i
         JOIN   members cb ON cb.id = i.created_by
         LEFT JOIN members ab ON ab.id = i.approved_by
         WHERE  i.id = $1 AND i.group_id = $2`,
        [id, ctx.groupId],
      );
      if (!inv) throw new NotFoundError('Investment', id);

      const { rows: returns } = await client.query(
        `SELECT ir.*, m.first_name || ' ' || m.last_name AS recorded_by_name
         FROM investment_returns ir
         JOIN members m ON m.id = ir.recorded_by
         WHERE ir.investment_id = $1 ORDER BY ir.return_date DESC`,
        [id],
      );
      const { rows: shares } = await client.query(
        `SELECT mis.*, m.first_name || ' ' || m.last_name AS member_name
         FROM member_investment_shares mis
         JOIN members m ON m.id = mis.member_id
         WHERE mis.investment_id = $1 ORDER BY mis.amount_contributed DESC`,
        [id],
      );
      return { ...inv, returns, shares };
    });
  },

  async create(ctx: TenantContext, data: CreateInvestmentInput) {
    return withTransaction(ctx, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO investments
           (group_id, name, description, investment_type, principal_amount,
            expected_return_rate, start_date, maturity_date, custodian,
            registration_number, location, notes, created_by, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending_approval')
         RETURNING *`,
        [ctx.groupId, data.name, data.description ?? null, data.investmentType,
         data.principalAmount, data.expectedReturnRate ?? null, data.startDate,
         data.maturityDate ?? null, data.custodian ?? null,
         data.registrationNumber ?? null, data.location ?? null,
         data.notes ?? null, ctx.userId],
      );
      return rows[0];
    });
  },

  async update(ctx: TenantContext, id: string, data: UpdateInvestmentInput) {
    return withTransaction(ctx, async (client) => {
      const { rows: [inv] } = await client.query(
        'SELECT * FROM investments WHERE id=$1 AND group_id=$2',
        [id, ctx.groupId],
      );
      if (!inv) throw new NotFoundError('Investment', id);

      const updates: string[] = ['updated_at=now()'];
      const args: unknown[] = [];
      let p = 1;

      if (data.currentValue !== undefined)     { updates.push(`current_value=$${p++}`);     args.push(data.currentValue); }
      if (data.status !== undefined)           { updates.push(`status=$${p++}`);             args.push(data.status); }
      if (data.custodian !== undefined)        { updates.push(`custodian=$${p++}`);          args.push(data.custodian); }
      if (data.notes !== undefined)            { updates.push(`notes=$${p++}`);              args.push(data.notes); }
      if (data.liquidationValue !== undefined) { updates.push(`liquidation_value=$${p++}`); args.push(data.liquidationValue); }

      if (data.status === 'active' && inv.status === 'pending_approval') {
        updates.push(`approved_by=$${p++}`, `approved_at=now()`);
        args.push(ctx.userId);
      }
      if (data.status === 'liquidated') {
        updates.push(`liquidated_by=$${p++}`, `liquidated_at=now()`);
        args.push(ctx.userId);
      }

      args.push(id, ctx.groupId);
      const { rows } = await client.query(
        `UPDATE investments SET ${updates.join(',')} WHERE id=$${p++} AND group_id=$${p++} RETURNING *`,
        args,
      );
      return rows[0];
    });
  },

  async recordReturn(ctx: TenantContext, investmentId: string, data: RecordReturnInput) {
    return withTransaction(ctx, async (client) => {
      const { rows: [inv] } = await client.query(
        'SELECT * FROM investments WHERE id=$1 AND group_id=$2',
        [investmentId, ctx.groupId],
      );
      if (!inv) throw new NotFoundError('Investment', investmentId);

      const { rows } = await client.query(
        `INSERT INTO investment_returns
           (investment_id, group_id, return_type, amount, return_date, receipt_number, notes, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [investmentId, ctx.groupId, data.returnType, data.amount,
         data.returnDate, data.receiptNumber ?? null, data.notes ?? null, ctx.userId],
      );
      return rows[0];
    });
  },

  async getSummary(ctx: TenantContext) {
    return withDb(ctx, async (client) => {
      const { rows: [s] } = await client.query(
        `SELECT
           COUNT(*)                                          AS total_investments,
           COUNT(*) FILTER (WHERE status='active')          AS active_count,
           COALESCE(SUM(principal_amount), 0)               AS total_principal,
           COALESCE(SUM(current_value) FILTER (WHERE status='active'), 0) AS total_current_value,
           COALESCE((
             SELECT SUM(amount) FROM investment_returns ir
             JOIN investments inv ON inv.id = ir.investment_id
             WHERE inv.group_id = $1
           ), 0) AS total_returns
         FROM investments WHERE group_id = $1`,
        [ctx.groupId],
      );
      return {
        totalInvestments: Number(s.total_investments),
        activeCount:      Number(s.active_count),
        totalPrincipal:   Number(s.total_principal),
        totalCurrentValue: Number(s.total_current_value),
        totalReturns:     Number(s.total_returns),
        roi: s.total_principal > 0
          ? ((Number(s.total_current_value) + Number(s.total_returns) - Number(s.total_principal)) / Number(s.total_principal)) * 100
          : 0,
      };
    });
  },
};
