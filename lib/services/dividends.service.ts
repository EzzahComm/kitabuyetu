import type { PoolClient } from 'pg';
import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import {
  ConflictError, NotFoundError, ValidationError,
} from '@/lib/utils/errors';
import type {
  CreateDividendDeclarationInput, UpdateDividendDeclarationInput,
  DividendQueryInput, PayAllocationInput, BulkPayAllocationsInput,
  DividendStatus, DividendPolicyType,
} from '@/lib/validators/dividends.schema';

// ── Types surfaced to API + UI ──────────────────────────────────────────

export interface DividendDeclaration {
  id:                     string;
  group_id:               string;
  period_label:           string;
  period_start:           string;
  period_end:             string;
  pool_amount:            string;
  policy_type:            DividendPolicyType | 'weighted';
  policy_config:          Record<string, unknown>;
  share_class_ids:        string[];
  withholding_tax_rate:   string;
  status:                 DividendStatus;
  notes:                  string | null;
  total_eligible_members: number;
  total_shares_snapshot:  string;
  total_allocated:        string;
  total_tax:              string;
  total_paid:             string;
  declared_by:            string;
  declared_at:            string;
  approved_by:            string | null;
  approved_at:            string | null;
  snapshot_at:            string | null;
  paid_at:                string | null;
  cancelled_by:           string | null;
  cancelled_at:           string | null;
  cancellation_reason:    string | null;
}

export interface DividendAllocation {
  id:                  string;
  declaration_id:      string;
  group_id:            string;
  member_id:           string;
  shares_held:         number;
  weight_factor:       string;
  gross_amount:        string;
  tax_amount:          string;
  net_amount:          string;
  status:              'pending' | 'paid' | 'reinvested' | 'cancelled';
  payment_method:      string | null;
  payment_reference:   string | null;
  paid_at:             string | null;
  paid_by:             string | null;
  reinvested_txn_id:   string | null;
  notes:               string | null;
  created_at:          string;
  updated_at:          string;

  // Joined denormalised fields.
  member_first_name?:  string;
  member_last_name?:   string;
  member_phone?:       string;
}

/** Virtual (pre-approval) allocation row — same shape as what would be persisted. */
export interface AllocationPreview {
  memberId:     string;
  firstName:    string;
  lastName:     string;
  phone:        string;
  sharesHeld:   number;
  weightFactor: number;
  grossAmount:  string;
  taxAmount:    string;
  netAmount:    string;
}

export interface AllocationComputation {
  rows:                AllocationPreview[];
  totalEligibleMembers: number;
  totalSharesSnapshot:  number;
  totalGross:           string;
  totalTax:             string;
  totalNet:             string;
  policyType:           DividendPolicyType;
  poolAmount:           string;
  withholdingTaxRate:   string;
  /** Difference between pool and sum(gross) caused by 2dp rounding. Reported so callers can show a "rounding remainder" notice. */
  roundingRemainder:    string;
}

// ─── Service ────────────────────────────────────────────────────────────

export const dividendsService = {

  // ── Declarations ─────────────────────────────────────────────────────

  async list(ctx: TenantContext, params: DividendQueryInput) {
    return withDb(ctx, async (client) => {
      const offset = (params.page - 1) * params.limit;
      const conds: string[] = ['group_id = $1'];
      const vals:  unknown[] = [ctx.groupId];
      if (params.status) { conds.push(`status = $${vals.length + 1}`); vals.push(params.status); }
      const where = conds.join(' AND ');

      const [{ rows: cnt }, { rows: items }] = await Promise.all([
        client.query<{ count: string }>(`SELECT COUNT(*) AS count FROM dividend_declarations WHERE ${where}`, vals),
        client.query<DividendDeclaration>(
          `SELECT * FROM dividend_declarations
            WHERE ${where}
            ORDER BY declared_at DESC
            LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`,
          [...vals, params.limit, offset],
        ),
      ]);

      const total = parseInt(cnt[0].count, 10);
      return {
        items, total,
        page: params.page, pageSize: params.limit,
        totalPages: Math.max(1, Math.ceil(total / params.limit)),
      };
    });
  },

  async get(ctx: TenantContext, declarationId: string): Promise<DividendDeclaration> {
    return withDb(ctx, async (client) => {
      const { rows } = await client.query<DividendDeclaration>(
        `SELECT * FROM dividend_declarations WHERE group_id = $1 AND id = $2`,
        [ctx.groupId, declarationId],
      );
      if (!rows[0]) throw new NotFoundError('Dividend declaration', declarationId);
      return rows[0];
    });
  },

  async create(ctx: TenantContext, input: CreateDividendDeclarationInput): Promise<DividendDeclaration> {
    return withTransaction(ctx, async (client) => {
      const { rows } = await client.query<DividendDeclaration>(
        `INSERT INTO dividend_declarations (
           group_id, period_label, period_start, period_end,
           pool_amount, policy_type, policy_config,
           share_class_ids, withholding_tax_rate, notes,
           declared_by
         ) VALUES (
           $1, $2, $3, $4,
           $5, $6::dividend_policy_type, $7::jsonb,
           $8::uuid[], $9, $10,
           $11
         ) RETURNING *`,
        [
          ctx.groupId, input.periodLabel, input.periodStart, input.periodEnd,
          input.poolAmount, input.policyType, JSON.stringify(input.policyConfig ?? {}),
          input.shareClassIds, input.withholdingTaxRate, input.notes ?? null,
          ctx.userId,
        ],
      );
      await writeAuditLog(client, ctx, 'dividend.create', rows[0].id, {
        period_label: input.periodLabel, pool_amount: input.poolAmount,
        policy_type: input.policyType,
      });
      return rows[0];
    });
  },

  async update(ctx: TenantContext, declarationId: string, input: UpdateDividendDeclarationInput): Promise<DividendDeclaration> {
    return withTransaction(ctx, async (client) => {
      // Edits only allowed while the declaration is still 'draft' — anything
      // beyond that is either pending board sign-off or already paid.
      const { rows: existing } = await client.query<{ status: DividendStatus }>(
        `SELECT status FROM dividend_declarations WHERE group_id = $1 AND id = $2 FOR UPDATE`,
        [ctx.groupId, declarationId],
      );
      if (!existing[0]) throw new NotFoundError('Dividend declaration', declarationId);
      if (existing[0].status !== 'draft') {
        throw new ConflictError(`Cannot edit a declaration in status '${existing[0].status}' — only drafts are editable`);
      }

      const fieldMap: Record<string, { col: string; cast?: string }> = {
        periodLabel:        { col: 'period_label' },
        periodStart:        { col: 'period_start' },
        periodEnd:          { col: 'period_end' },
        poolAmount:         { col: 'pool_amount' },
        policyType:         { col: 'policy_type',         cast: '::dividend_policy_type' },
        policyConfig:       { col: 'policy_config',       cast: '::jsonb' },
        shareClassIds:      { col: 'share_class_ids',     cast: '::uuid[]' },
        withholdingTaxRate: { col: 'withholding_tax_rate' },
        notes:              { col: 'notes' },
      };

      const sets: string[]    = [];
      const values: unknown[] = [];
      let idx = 1;
      for (const [field, spec] of Object.entries(fieldMap)) {
        const v = (input as Record<string, unknown>)[field];
        if (v !== undefined) {
          const value = field === 'policyConfig' ? JSON.stringify(v) : v;
          sets.push(`${spec.col} = $${idx++}${spec.cast ?? ''}`);
          values.push(value);
        }
      }
      if (sets.length === 0) throw new ValidationError('No fields to update');

      values.push(ctx.groupId, declarationId);
      const { rows } = await client.query<DividendDeclaration>(
        `UPDATE dividend_declarations SET ${sets.join(', ')}
          WHERE group_id = $${idx++} AND id = $${idx++}
          RETURNING *`,
        values,
      );
      await writeAuditLog(client, ctx, 'dividend.update', declarationId, input as Record<string, unknown>);
      return rows[0];
    });
  },

  // ── Allocations: virtual preview + persisted snapshot ────────────────

  /**
   * Compute what allocations would look like right now without persisting.
   * Used for the preview UI on draft/pending declarations and re-used by
   * approve() to do the real snapshot.
   */
  async previewAllocations(ctx: TenantContext, declarationId: string): Promise<AllocationComputation> {
    return withDb(ctx, async (client) => {
      const decl = await fetchDeclaration(client, ctx.groupId, declarationId);
      return computeAllocations(client, decl);
    });
  },

  async listAllocations(ctx: TenantContext, declarationId: string): Promise<DividendAllocation[]> {
    return withDb(ctx, async (client) => {
      await fetchDeclaration(client, ctx.groupId, declarationId); // verifies access
      const { rows } = await client.query<DividendAllocation>(
        `SELECT a.*,
                m.first_name AS member_first_name,
                m.last_name  AS member_last_name,
                m.phone      AS member_phone
           FROM dividend_allocations a
           JOIN members m ON m.id = a.member_id
          WHERE a.declaration_id = $1
          ORDER BY a.gross_amount DESC, m.first_name ASC`,
        [declarationId],
      );
      return rows;
    });
  },

  // ── Status transitions ───────────────────────────────────────────────

  async submitForApproval(ctx: TenantContext, declarationId: string): Promise<DividendDeclaration> {
    return withTransaction(ctx, async (client) => {
      const decl = await fetchDeclarationForUpdate(client, ctx.groupId, declarationId);
      if (decl.status !== 'draft') {
        throw new ConflictError(`Cannot submit a declaration in status '${decl.status}'`);
      }
      const { rows } = await client.query<DividendDeclaration>(
        `UPDATE dividend_declarations
            SET status = 'pending_approval'
          WHERE id = $1
          RETURNING *`,
        [declarationId],
      );
      await writeAuditLog(client, ctx, 'dividend.submit', declarationId, {});
      return rows[0];
    });
  },

  /**
   * Snapshot eligible holdings, compute allocations, persist them, mark the
   * declaration approved. Restricted to group_admin at the API layer.
   */
  async approve(ctx: TenantContext, declarationId: string): Promise<{ declaration: DividendDeclaration; allocations: DividendAllocation[] }> {
    return withTransaction(ctx, async (client) => {
      const decl = await fetchDeclarationForUpdate(client, ctx.groupId, declarationId);
      if (decl.status !== 'pending_approval' && decl.status !== 'draft') {
        throw new ConflictError(`Cannot approve a declaration in status '${decl.status}'`);
      }

      const computed = await computeAllocations(client, decl);
      if (computed.rows.length === 0) {
        throw new ValidationError(
          'No eligible shareholders for this declaration — at least one member with shares is required',
        );
      }

      // Persist allocations. Wipe any leftovers from a previous attempt so a
      // re-approve (after rollback to draft) doesn't accumulate orphans.
      await client.query(`DELETE FROM dividend_allocations WHERE declaration_id = $1`, [declarationId]);

      const allocs: DividendAllocation[] = [];
      for (const row of computed.rows) {
        const { rows: ins } = await client.query<DividendAllocation>(
          `INSERT INTO dividend_allocations (
             declaration_id, group_id, member_id,
             shares_held, weight_factor,
             gross_amount, tax_amount, net_amount
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [
            declarationId, decl.group_id, row.memberId,
            row.sharesHeld, row.weightFactor.toFixed(6),
            row.grossAmount, row.taxAmount, row.netAmount,
          ],
        );
        allocs.push(ins[0]);
      }

      const { rows: updated } = await client.query<DividendDeclaration>(
        `UPDATE dividend_declarations SET
           status                 = 'approved',
           approved_by            = $2,
           approved_at            = NOW(),
           snapshot_at            = NOW(),
           total_eligible_members = $3,
           total_shares_snapshot  = $4,
           total_allocated        = $5,
           total_tax              = $6
         WHERE id = $1
         RETURNING *`,
        [
          declarationId, ctx.userId,
          computed.totalEligibleMembers,
          computed.totalSharesSnapshot,
          computed.totalGross,
          computed.totalTax,
        ],
      );

      await writeAuditLog(client, ctx, 'dividend.approve', declarationId, {
        eligible_members: computed.totalEligibleMembers,
        total_gross: computed.totalGross,
        total_tax: computed.totalTax,
      });

      return { declaration: updated[0], allocations: allocs };
    });
  },

  async cancel(ctx: TenantContext, declarationId: string, reason: string): Promise<DividendDeclaration> {
    return withTransaction(ctx, async (client) => {
      const decl = await fetchDeclarationForUpdate(client, ctx.groupId, declarationId);
      if (decl.status === 'paid' || decl.status === 'cancelled') {
        throw new ConflictError(`Cannot cancel a declaration in status '${decl.status}'`);
      }

      // If allocations were already persisted (approved+), make sure none
      // are already paid — once cash has left we can't fold the declaration.
      if (decl.status === 'approved') {
        const { rows } = await client.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM dividend_allocations
            WHERE declaration_id = $1 AND status = 'paid'`,
          [declarationId],
        );
        if (parseInt(rows[0].count, 10) > 0) {
          throw new ConflictError(
            'Some allocations have already been paid out — cancel each unpaid allocation individually instead',
          );
        }
        await client.query(
          `UPDATE dividend_allocations SET status = 'cancelled', updated_at = NOW()
            WHERE declaration_id = $1 AND status = 'pending'`,
          [declarationId],
        );
      }

      const { rows } = await client.query<DividendDeclaration>(
        `UPDATE dividend_declarations SET
           status              = 'cancelled',
           cancelled_at        = NOW(),
           cancelled_by        = $2,
           cancellation_reason = $3
         WHERE id = $1
         RETURNING *`,
        [declarationId, ctx.userId, reason],
      );

      await writeAuditLog(client, ctx, 'dividend.cancel', declarationId, { reason });
      return rows[0];
    });
  },

  // ── Payments ─────────────────────────────────────────────────────────

  async payAllocation(
    ctx: TenantContext,
    declarationId: string,
    allocationId: string,
    input: PayAllocationInput,
  ): Promise<DividendAllocation> {
    return withTransaction(ctx, async (client) => {
      const decl = await fetchDeclarationForUpdate(client, ctx.groupId, declarationId);
      if (decl.status !== 'approved') {
        throw new ConflictError(`Cannot record payments — declaration is in status '${decl.status}'`);
      }

      const { rows: a } = await client.query<DividendAllocation>(
        `SELECT * FROM dividend_allocations
          WHERE id = $1 AND declaration_id = $2 AND group_id = $3
          FOR UPDATE`,
        [allocationId, declarationId, ctx.groupId],
      );
      if (!a[0])                  throw new NotFoundError('Dividend allocation', allocationId);
      if (a[0].status !== 'pending') throw new ConflictError(`Allocation is in status '${a[0].status}' — only pending allocations can be paid`);

      const { rows: updated } = await client.query<DividendAllocation>(
        `UPDATE dividend_allocations SET
           status            = 'paid',
           payment_method    = $2,
           payment_reference = $3,
           paid_at           = NOW(),
           paid_by           = $4,
           notes             = COALESCE($5, notes),
           updated_at        = NOW()
         WHERE id = $1
         RETURNING *`,
        [allocationId, input.paymentMethod, input.paymentReference ?? null, ctx.userId, input.notes ?? null],
      );

      await rollUpTotals(client, declarationId);
      await writeAuditLog(client, ctx, 'dividend.allocation.pay', allocationId, {
        declaration_id: declarationId, method: input.paymentMethod, amount: a[0].net_amount,
      });
      return updated[0];
    });
  },

  async bulkPayAllocations(
    ctx: TenantContext,
    declarationId: string,
    input: BulkPayAllocationsInput,
  ): Promise<{ paid: number; skipped: { id: string; reason: string }[] }> {
    return withTransaction(ctx, async (client) => {
      const decl = await fetchDeclarationForUpdate(client, ctx.groupId, declarationId);
      if (decl.status !== 'approved') {
        throw new ConflictError(`Cannot record payments — declaration is in status '${decl.status}'`);
      }

      const skipped: { id: string; reason: string }[] = [];
      let paid = 0;

      for (const id of input.allocationIds) {
        const { rows: a } = await client.query<{ status: string }>(
          `SELECT status FROM dividend_allocations
            WHERE id = $1 AND declaration_id = $2 AND group_id = $3
            FOR UPDATE`,
          [id, declarationId, ctx.groupId],
        );
        if (!a[0])                       { skipped.push({ id, reason: 'Not found' }); continue; }
        if (a[0].status !== 'pending')   { skipped.push({ id, reason: `Status is ${a[0].status}` }); continue; }

        await client.query(
          `UPDATE dividend_allocations SET
             status            = 'paid',
             payment_method    = $2,
             payment_reference = $3,
             paid_at           = NOW(),
             paid_by           = $4,
             notes             = COALESCE($5, notes),
             updated_at        = NOW()
           WHERE id = $1`,
          [id, input.paymentMethod, input.paymentReference ?? null, ctx.userId, input.notes ?? null],
        );
        paid++;
      }

      await rollUpTotals(client, declarationId);
      await writeAuditLog(client, ctx, 'dividend.allocation.bulk_pay', declarationId, {
        paid, skipped: skipped.length, method: input.paymentMethod,
      });

      return { paid, skipped };
    });
  },

  async cancelAllocation(
    ctx: TenantContext,
    declarationId: string,
    allocationId: string,
    reason: string,
  ): Promise<DividendAllocation> {
    return withTransaction(ctx, async (client) => {
      const decl = await fetchDeclarationForUpdate(client, ctx.groupId, declarationId);
      if (decl.status !== 'approved') {
        throw new ConflictError(`Cannot cancel allocations — declaration is in status '${decl.status}'`);
      }

      const { rows: updated } = await client.query<DividendAllocation>(
        `UPDATE dividend_allocations SET
           status     = 'cancelled',
           notes      = COALESCE(notes || E'\n', '') || $3,
           updated_at = NOW()
         WHERE id = $1 AND declaration_id = $2 AND status = 'pending'
         RETURNING *`,
        [allocationId, declarationId, `Cancelled: ${reason}`],
      );
      if (!updated[0]) throw new ConflictError('Allocation not found or not in pending status');

      await rollUpTotals(client, declarationId);
      await writeAuditLog(client, ctx, 'dividend.allocation.cancel', allocationId, { reason });
      return updated[0];
    });
  },
};

// ─── Internal helpers ────────────────────────────────────────────────────

async function fetchDeclaration(client: PoolClient, groupId: string, id: string): Promise<DividendDeclaration> {
  const { rows } = await client.query<DividendDeclaration>(
    `SELECT * FROM dividend_declarations WHERE group_id = $1 AND id = $2`,
    [groupId, id],
  );
  if (!rows[0]) throw new NotFoundError('Dividend declaration', id);
  return rows[0];
}

async function fetchDeclarationForUpdate(client: PoolClient, groupId: string, id: string): Promise<DividendDeclaration> {
  const { rows } = await client.query<DividendDeclaration>(
    `SELECT * FROM dividend_declarations WHERE group_id = $1 AND id = $2 FOR UPDATE`,
    [groupId, id],
  );
  if (!rows[0]) throw new NotFoundError('Dividend declaration', id);
  return rows[0];
}

/**
 * Refresh declaration totals after any allocation status change. When every
 * non-cancelled allocation is paid, also bump the declaration to 'paid'.
 */
async function rollUpTotals(client: PoolClient, declarationId: string): Promise<void> {
  const { rows } = await client.query<{
    total_paid: string;
    pending_count: string;
    total_count: string;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'paid' THEN net_amount ELSE 0 END), 0)::text AS total_paid,
       COUNT(*) FILTER (WHERE status = 'pending')::text                              AS pending_count,
       COUNT(*) FILTER (WHERE status <> 'cancelled')::text                           AS total_count
     FROM dividend_allocations
     WHERE declaration_id = $1`,
    [declarationId],
  );

  const totalPaid    = rows[0]?.total_paid    ?? '0';
  const pendingCount = parseInt(rows[0]?.pending_count ?? '0', 10);
  const totalCount   = parseInt(rows[0]?.total_count   ?? '0', 10);

  await client.query(
    `UPDATE dividend_declarations
        SET total_paid = $2,
            status     = CASE
                           WHEN status = 'approved' AND $3::int = 0 AND $4::int > 0 THEN 'paid'
                           ELSE status
                         END,
            paid_at    = CASE
                           WHEN status = 'approved' AND $3::int = 0 AND $4::int > 0 AND paid_at IS NULL THEN NOW()
                           ELSE paid_at
                         END
      WHERE id = $1`,
    [declarationId, totalPaid, pendingCount, totalCount],
  );
}

/**
 * Core computation. Pulls eligible holdings, applies the policy, applies
 * withholding tax, and rounds. The result is virtual — callers persist it
 * (in approve) or just preview it.
 */
async function computeAllocations(
  client: PoolClient,
  decl:   DividendDeclaration,
): Promise<AllocationComputation> {
  if (decl.policy_type === 'weighted') {
    throw new ValidationError(
      "The 'weighted' policy isn't supported yet — coming in E5.2. Use 'proportional_to_shares' or 'flat_per_member'.",
    );
  }

  // Holdings query. share_class_ids = empty array means "all active classes".
  // The members.first_name/last_name/phone join is for the preview UI; the
  // service trims it down before returning if needed.
  const params: unknown[] = [decl.group_id];
  let classFilter = '';
  if ((decl.share_class_ids ?? []).length > 0) {
    classFilter = `AND h.share_class_id = ANY($${params.length + 1}::uuid[])`;
    params.push(decl.share_class_ids);
  }

  const { rows: holdings } = await client.query<{
    member_id: string; first_name: string; last_name: string; phone: string;
    total_shares: string;
  }>(
    `SELECT h.member_id,
            m.first_name,
            m.last_name,
            m.phone,
            SUM(h.quantity)::text AS total_shares
       FROM share_holdings h
       JOIN members m ON m.id = h.member_id
       JOIN share_classes c ON c.id = h.share_class_id AND c.is_active = TRUE
      WHERE h.group_id = $1
        AND h.quantity > 0
        ${classFilter}
      GROUP BY h.member_id, m.first_name, m.last_name, m.phone
      HAVING SUM(h.quantity) > 0
      ORDER BY total_shares DESC, m.first_name ASC`,
    params,
  );

  const pool   = Number(decl.pool_amount);
  const taxR   = Number(decl.withholding_tax_rate);
  const totalShares = holdings.reduce((s, h) => s + parseInt(h.total_shares, 10), 0);
  const n      = holdings.length;

  const rows: AllocationPreview[] = [];
  let runningGross = 0;
  let runningTax   = 0;
  let runningNet   = 0;

  for (const h of holdings) {
    const shares = parseInt(h.total_shares, 10);
    let gross: number;

    if (decl.policy_type === 'flat_per_member') {
      gross = n > 0 ? pool / n : 0;
    } else {
      // proportional_to_shares (default)
      gross = totalShares > 0 ? (shares / totalShares) * pool : 0;
    }

    gross = round2(gross);
    const tax = round2(gross * taxR);
    const net = round2(gross - tax);

    runningGross += gross;
    runningTax   += tax;
    runningNet   += net;

    rows.push({
      memberId:     h.member_id,
      firstName:    h.first_name,
      lastName:     h.last_name,
      phone:        h.phone,
      sharesHeld:   shares,
      weightFactor: 1,
      grossAmount:  gross.toFixed(2),
      taxAmount:    tax.toFixed(2),
      netAmount:    net.toFixed(2),
    });
  }

  const remainder = round2(pool - runningGross);

  return {
    rows,
    totalEligibleMembers: n,
    totalSharesSnapshot:  totalShares,
    totalGross:           runningGross.toFixed(2),
    totalTax:             runningTax.toFixed(2),
    totalNet:             runningNet.toFixed(2),
    policyType:           decl.policy_type,
    poolAmount:           pool.toFixed(2),
    withholdingTaxRate:   taxR.toFixed(4),
    roundingRemainder:    remainder.toFixed(2),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function writeAuditLog(
  client: PoolClient,
  ctx:    TenantContext,
  action: string,
  resourceId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, new_values)
     VALUES ($1, $2, $3, 'dividend', $4, $5::jsonb)`,
    [ctx.groupId, ctx.userId, action, resourceId, JSON.stringify(payload)],
  );
}
