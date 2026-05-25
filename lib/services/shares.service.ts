import type { PoolClient } from 'pg';
import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import {
  ConflictError, NotFoundError, ValidationError,
} from '@/lib/utils/errors';
import type {
  CreateShareClassInput, UpdateShareClassInput,
  CreateShareTransactionInput, ShareTxnQueryInput, HoldingsQueryInput,
} from '@/lib/validators/shares.schema';

// ─── Types surfaced to API + UI ─────────────────────────────────────────

export interface ShareClass {
  id:                string;
  group_id:          string;
  name:              string;
  code:              string;
  description:       string | null;
  par_value:         string;       // pg returns NUMERIC as string
  current_value:     string | null;
  min_per_member:    number | null;
  max_per_member:    number | null;
  voting_weight:     string;
  transfer_allowed:  boolean;
  lock_period_days:  number;
  is_active:         boolean;
  created_at:        string;
  updated_at:        string;
}

export interface ShareTransaction {
  id:                       string;
  group_id:                 string;
  member_id:                string;
  share_class_id:           string;
  type:                     'allocation' | 'purchase' | 'transfer_in' | 'transfer_out' | 'redemption' | 'adjustment';
  status:                   'posted' | 'reversed';
  quantity:                 number;
  unit_price:               string;
  total_amount:             string;
  counterparty_member_id:   string | null;
  payment_method:           string | null;
  payment_reference:        string | null;
  certificate_serial:       string | null;
  reverses_transaction_id:  string | null;
  notes:                    string | null;
  created_by:               string;
  created_at:               string;
  posted_at:                string;

  // Joined denormalised fields surfaced for UI convenience.
  member_first_name?:       string;
  member_last_name?:        string;
  member_phone?:            string;
  share_class_name?:        string;
  share_class_code?:        string;
  counterparty_first_name?: string | null;
  counterparty_last_name?:  string | null;
}

export interface ShareHolding {
  group_id:            string;
  member_id:           string;
  share_class_id:      string;
  quantity:            number;
  total_invested:      string;
  first_acquired_at:   string | null;
  last_transaction_at: string | null;

  member_first_name?:  string;
  member_last_name?:   string;
  member_phone?:       string;
  share_class_name?:   string;
  share_class_code?:   string;
  share_class_par:     string;
  share_class_current: string | null;
}

export interface GroupShareSummary {
  totalClasses:        number;
  totalShareholders:   number;
  totalShares:         number;
  totalShareCapital:   string;   // SUM(quantity * effective_value) across all holdings
  totalInvested:       string;   // SUM(total_invested) across all holdings
  byClass: {
    classId:           string;
    code:              string;
    name:              string;
    sharesIssued:      number;
    shareholders:      number;
    effectiveValue:    string;
    capitalAtValue:    string;
  }[];
  topHolders: {
    memberId:          string;
    firstName:         string;
    lastName:          string;
    totalShares:       number;
    totalInvested:     string;
  }[];
}

// ─── Service ────────────────────────────────────────────────────────────

export const sharesService = {

  // ── Share classes ────────────────────────────────────────────────────

  async listClasses(ctx: TenantContext, opts: { activeOnly?: boolean } = {}): Promise<ShareClass[]> {
    return withDb(ctx, async (client) => {
      const where = opts.activeOnly ? `AND is_active = TRUE` : '';
      const { rows } = await client.query<ShareClass>(
        `SELECT * FROM share_classes
          WHERE group_id = $1 ${where}
          ORDER BY is_active DESC, name ASC`,
        [ctx.groupId],
      );
      return rows;
    });
  },

  async getClass(ctx: TenantContext, classId: string): Promise<ShareClass> {
    return withDb(ctx, async (client) => {
      const { rows } = await client.query<ShareClass>(
        `SELECT * FROM share_classes WHERE group_id = $1 AND id = $2`,
        [ctx.groupId, classId],
      );
      if (!rows[0]) throw new NotFoundError('Share class', classId);
      return rows[0];
    });
  },

  async createClass(ctx: TenantContext, input: CreateShareClassInput): Promise<ShareClass> {
    return withTransaction(ctx, async (client) => {
      try {
        const { rows } = await client.query<ShareClass>(
          `INSERT INTO share_classes (
             group_id, name, code, description, par_value, current_value,
             min_per_member, max_per_member, voting_weight, transfer_allowed,
             lock_period_days, is_active
           ) VALUES ($1,$2,UPPER($3),$4,$5,$6,$7,$8,$9,$10,$11,$12)
           RETURNING *`,
          [
            ctx.groupId, input.name, input.code, input.description ?? null,
            input.parValue, input.currentValue ?? null,
            input.minPerMember ?? null, input.maxPerMember ?? null,
            input.votingWeight, input.transferAllowed,
            input.lockPeriodDays, input.isActive,
          ],
        );
        await writeAuditLog(client, ctx, 'share_class.create', rows[0].id, {
          name: input.name, code: input.code, par_value: input.parValue,
        });
        return rows[0];
      } catch (err: unknown) {
        const e = err as { code?: string; constraint?: string };
        if (e?.code === '23505' && e?.constraint === 'uq_share_class_code') {
          throw new ConflictError(`A share class with code '${input.code.toUpperCase()}' already exists in this group`);
        }
        throw err;
      }
    });
  },

  async updateClass(ctx: TenantContext, classId: string, input: UpdateShareClassInput): Promise<ShareClass> {
    return withTransaction(ctx, async (client) => {
      const fieldMap: Record<string, string> = {
        name:             'name',
        code:             'code',
        description:      'description',
        parValue:         'par_value',
        currentValue:     'current_value',
        minPerMember:     'min_per_member',
        maxPerMember:     'max_per_member',
        votingWeight:     'voting_weight',
        transferAllowed:  'transfer_allowed',
        lockPeriodDays:   'lock_period_days',
        isActive:         'is_active',
      };
      const sets: string[]   = [];
      const values: unknown[] = [];
      let idx = 1;
      for (const [field, column] of Object.entries(fieldMap)) {
        const v = (input as Record<string, unknown>)[field];
        if (v !== undefined) {
          // 'code' normalised to uppercase to match the unique-index path.
          const value = (field === 'code' && typeof v === 'string') ? v.toUpperCase() : v;
          sets.push(`${column} = $${idx++}`);
          values.push(value);
        }
      }
      if (sets.length === 0) throw new ValidationError('No fields to update');
      sets.push(`updated_at = NOW()`);
      values.push(ctx.groupId, classId);

      try {
        const { rows } = await client.query<ShareClass>(
          `UPDATE share_classes SET ${sets.join(', ')}
            WHERE group_id = $${idx++} AND id = $${idx++}
            RETURNING *`,
          values,
        );
        if (!rows[0]) throw new NotFoundError('Share class', classId);
        await writeAuditLog(client, ctx, 'share_class.update', classId, input as Record<string, unknown>);
        return rows[0];
      } catch (err: unknown) {
        const e = err as { code?: string; constraint?: string };
        if (e?.code === '23505' && e?.constraint === 'uq_share_class_code') {
          throw new ConflictError('Another share class in this group already uses that code');
        }
        throw err;
      }
    });
  },

  // ── Share transactions ───────────────────────────────────────────────

  async createTransaction(ctx: TenantContext, input: CreateShareTransactionInput): Promise<ShareTransaction[]> {
    return withTransaction(ctx, async (client) => {
      // Resolve share class and lock it FOR SHARE so its config doesn't shift mid-txn.
      const { rows: cls } = await client.query<{ id: string; code: string; par_value: string; current_value: string | null; is_active: boolean; max_per_member: number | null; transfer_allowed: boolean; lock_period_days: number }>(
        `SELECT id, code, par_value, current_value, is_active, max_per_member, transfer_allowed, lock_period_days
           FROM share_classes
          WHERE group_id = $1 AND id = $2
          FOR SHARE`,
        [ctx.groupId, input.shareClassId],
      );
      if (!cls[0])              throw new NotFoundError('Share class', input.shareClassId);
      if (!cls[0].is_active)    throw new ConflictError('Share class is inactive — re-activate it before posting transactions');
      if (input.type === 'transfer' && !cls[0].transfer_allowed) {
        throw new ConflictError(`Transfers are disabled for share class '${cls[0].code}'`);
      }

      // Lock-period check on outflows. We use the last *acquisition* date
      // (the most recent inflow), not last_transaction_at — a previous
      // outflow would otherwise reset the lock clock and let members
      // sidestep the policy with a sacrificial small redemption.
      const isOutflow = input.type === 'redemption' || input.type === 'transfer';
      if (isOutflow && cls[0].lock_period_days > 0) {
        const lastAcq = await getLastAcquisitionAt(client, ctx.groupId, input.memberId, input.shareClassId);
        if (lastAcq) {
          const unlockAt = new Date(lastAcq.getTime() + cls[0].lock_period_days * 24 * 60 * 60 * 1000);
          if (new Date() < unlockAt) {
            const daysLeft = Math.ceil((unlockAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
            throw new ConflictError(
              `Lock period active for class '${cls[0].code}': last acquisition was on ${lastAcq.toISOString().slice(0, 10)}; shares unlock on ${unlockAt.toISOString().slice(0, 10)} (${daysLeft} day(s) remaining)`,
            );
          }
        }
      }

      // Membership check — keeps the FK error clean.
      await assertGroupMembership(client, ctx.groupId, input.memberId, 'memberId');
      if (input.counterpartyMemberId) {
        await assertGroupMembership(client, ctx.groupId, input.counterpartyMemberId, 'counterpartyMemberId');
      }

      const unitPrice: number = input.unitPrice
        ?? Number(cls[0].current_value ?? cls[0].par_value);
      const qtyAbs = Math.abs(input.quantity);
      const totalAmount: number = input.totalAmount
        ?? (input.type === 'allocation' ? 0 : qtyAbs * unitPrice);

      // Outflow checks: ensure sender has enough shares of this class.
      if (input.type === 'redemption' || input.type === 'transfer') {
        const senderBalance = await getMemberBalance(client, ctx.groupId, input.memberId, input.shareClassId);
        if (senderBalance < qtyAbs) {
          throw new ConflictError(
            `Member only holds ${senderBalance} share(s) of '${cls[0].code}' — cannot ${input.type} ${qtyAbs}`,
          );
        }
      }

      // Inflow checks: enforce max_per_member (after this txn).
      if (cls[0].max_per_member !== null) {
        const checks: { memberId: string; addAfter: number }[] = [];
        if (input.type === 'purchase' || input.type === 'allocation') {
          checks.push({ memberId: input.memberId, addAfter: qtyAbs });
        }
        if (input.type === 'transfer') {
          checks.push({ memberId: input.counterpartyMemberId!, addAfter: qtyAbs });
        }
        if (input.type === 'adjustment' && input.quantity > 0) {
          checks.push({ memberId: input.memberId, addAfter: input.quantity });
        }
        for (const c of checks) {
          const current = await getMemberBalance(client, ctx.groupId, c.memberId, input.shareClassId);
          if (current + c.addAfter > cls[0].max_per_member) {
            throw new ConflictError(
              `Holding would exceed the per-member cap of ${cls[0].max_per_member} for class '${cls[0].code}'`,
            );
          }
        }
      }

      const inserted: ShareTransaction[] = [];

      if (input.type === 'transfer') {
        // Pair: transfer_out for sender, transfer_in for receiver. Both use
        // the same posted_at so the ledger orders them adjacently.
        const postedAt = new Date().toISOString();
        const outSerial = null;   // outflow doesn't issue a cert
        const inSerial  = await allocateSerial(client, ctx.groupId, cls[0].code);

        const outRow = await insertTxn(client, {
          group_id:               ctx.groupId,
          member_id:              input.memberId,
          share_class_id:         input.shareClassId,
          type:                   'transfer_out',
          quantity:               -qtyAbs,
          unit_price:             unitPrice,
          total_amount:           totalAmount,
          counterparty_member_id: input.counterpartyMemberId!,
          payment_method:         null,
          payment_reference:      null,
          certificate_serial:     outSerial,
          notes:                  input.notes ?? null,
          created_by:             ctx.userId,
          posted_at:              postedAt,
        });
        const inRow = await insertTxn(client, {
          group_id:               ctx.groupId,
          member_id:              input.counterpartyMemberId!,
          share_class_id:         input.shareClassId,
          type:                   'transfer_in',
          quantity:               +qtyAbs,
          unit_price:             unitPrice,
          total_amount:           totalAmount,
          counterparty_member_id: input.memberId,
          payment_method:         null,
          payment_reference:      null,
          certificate_serial:     inSerial,
          notes:                  input.notes ?? null,
          created_by:             ctx.userId,
          posted_at:              postedAt,
        });
        inserted.push(outRow, inRow);
        await writeAuditLog(client, ctx, 'share_txn.transfer', outRow.id, {
          from_member: input.memberId, to_member: input.counterpartyMemberId,
          quantity: qtyAbs, class_id: input.shareClassId,
        });
      } else {
        // Single-row insert paths.
        const dbType = ({
          allocation: 'allocation',
          purchase:   'purchase',
          redemption: 'redemption',
          adjustment: 'adjustment',
        } as const)[input.type as 'allocation' | 'purchase' | 'redemption' | 'adjustment'];

        // Sign convention: redemption always negative; allocation/purchase positive;
        // adjustment keeps the sign the caller passed.
        const dbQuantity =
          input.type === 'redemption' ? -qtyAbs :
          input.type === 'adjustment' ? input.quantity :
          qtyAbs;

        const serial =
          (input.type === 'allocation' || input.type === 'purchase' || (input.type === 'adjustment' && dbQuantity > 0))
            ? await allocateSerial(client, ctx.groupId, cls[0].code)
            : null;

        const row = await insertTxn(client, {
          group_id:               ctx.groupId,
          member_id:              input.memberId,
          share_class_id:         input.shareClassId,
          type:                   dbType,
          quantity:               dbQuantity,
          unit_price:             unitPrice,
          total_amount:           totalAmount,
          counterparty_member_id: null,
          payment_method:         input.paymentMethod ?? null,
          payment_reference:      input.paymentReference ?? null,
          certificate_serial:     serial,
          notes:                  input.notes ?? null,
          created_by:             ctx.userId,
          posted_at:              input.postedAt ?? new Date().toISOString(),
        });
        inserted.push(row);
        await writeAuditLog(client, ctx, `share_txn.${input.type}`, row.id, {
          member_id: input.memberId, class_id: input.shareClassId,
          quantity: dbQuantity, unit_price: unitPrice, total_amount: totalAmount,
        });
      }

      return inserted;
    });
  },

  async listTransactions(ctx: TenantContext, params: ShareTxnQueryInput) {
    return withDb(ctx, async (client) => {
      const offset = (params.page - 1) * params.limit;
      const conds: string[] = ['t.group_id = $1'];
      const vals:  unknown[] = [ctx.groupId];
      const addCond = (sql: string, v: unknown) => { conds.push(sql.replace('$$', `$${vals.length + 1}`)); vals.push(v); };

      if (params.type) {
        // Surface 'transfer' as either leg.
        if (params.type === 'transfer') {
          conds.push(`t.type IN ('transfer_in','transfer_out')`);
        } else {
          addCond(`t.type = $$`, params.type);
        }
      }
      if (params.memberId)     addCond(`t.member_id      = $$`, params.memberId);
      if (params.shareClassId) addCond(`t.share_class_id = $$`, params.shareClassId);
      if (params.from)         addCond(`t.posted_at     >= $$`, params.from);
      if (params.to)           addCond(`t.posted_at     <= ($$ ::date + INTERVAL '1 day')`, params.to);

      const where = conds.join(' AND ');

      const [{ rows: cnt }, { rows: items }] = await Promise.all([
        client.query<{ count: string }>(`SELECT COUNT(*) AS count FROM share_transactions t WHERE ${where}`, vals),
        client.query<ShareTransaction>(
          `SELECT t.*,
                  m.first_name  AS member_first_name,
                  m.last_name   AS member_last_name,
                  m.phone       AS member_phone,
                  c.name        AS share_class_name,
                  c.code        AS share_class_code,
                  cp.first_name AS counterparty_first_name,
                  cp.last_name  AS counterparty_last_name
             FROM share_transactions t
             JOIN members        m  ON m.id  = t.member_id
             JOIN share_classes  c  ON c.id  = t.share_class_id
        LEFT JOIN members        cp ON cp.id = t.counterparty_member_id
            WHERE ${where}
            ORDER BY t.posted_at DESC, t.created_at DESC
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

  async getTransaction(ctx: TenantContext, txnId: string): Promise<ShareTransaction> {
    return withDb(ctx, async (client) => {
      const { rows } = await client.query<ShareTransaction>(
        `SELECT t.*,
                m.first_name  AS member_first_name,
                m.last_name   AS member_last_name,
                m.phone       AS member_phone,
                c.name        AS share_class_name,
                c.code        AS share_class_code,
                cp.first_name AS counterparty_first_name,
                cp.last_name  AS counterparty_last_name
           FROM share_transactions t
           JOIN members        m  ON m.id  = t.member_id
           JOIN share_classes  c  ON c.id  = t.share_class_id
      LEFT JOIN members        cp ON cp.id = t.counterparty_member_id
          WHERE t.group_id = $1 AND t.id = $2`,
        [ctx.groupId, txnId],
      );
      if (!rows[0]) throw new NotFoundError('Share transaction', txnId);
      return rows[0];
    });
  },

  /**
   * Reverse a posted transaction by inserting an offsetting row that undoes
   * the share-count delta and flips the original to status='reversed'. Both
   * rows reference each other via reverses_transaction_id so the audit
   * trail is bidirectional.
   */
  async reverseTransaction(ctx: TenantContext, txnId: string, reason: string): Promise<ShareTransaction> {
    return withTransaction(ctx, async (client) => {
      const { rows: origRows } = await client.query<ShareTransaction>(
        `SELECT * FROM share_transactions
          WHERE group_id = $1 AND id = $2
          FOR UPDATE`,
        [ctx.groupId, txnId],
      );
      const orig = origRows[0];
      if (!orig)                       throw new NotFoundError('Share transaction', txnId);
      if (orig.status !== 'posted')    throw new ConflictError(`Transaction is in status '${orig.status}' — only posted transactions can be reversed`);
      if (orig.reverses_transaction_id) throw new ConflictError(`Transaction is itself a reversal — cannot be reversed again`);

      // Reversal is an adjustment that subtracts what the original added.
      const reverseRow = await insertTxn(client, {
        group_id:               orig.group_id,
        member_id:              orig.member_id,
        share_class_id:         orig.share_class_id,
        type:                   'adjustment',
        quantity:               -orig.quantity,
        unit_price:             Number(orig.unit_price),
        total_amount:           Number(orig.total_amount),
        counterparty_member_id: null,
        payment_method:         null,
        payment_reference:      null,
        certificate_serial:     null,
        notes:                  `Reversal of ${orig.id}: ${reason}`,
        created_by:             ctx.userId,
        posted_at:              new Date().toISOString(),
        reverses_transaction_id: orig.id,
      });

      // Mark the original as 'reversed' (allowed by the immutability trigger).
      await client.query(
        `UPDATE share_transactions
            SET status = 'reversed',
                reverses_transaction_id = $2
          WHERE id = $1`,
        [orig.id, reverseRow.id],
      );

      await writeAuditLog(client, ctx, 'share_txn.reverse', orig.id, {
        reverse_txn_id: reverseRow.id, reason,
      });

      return reverseRow;
    });
  },

  // ── Holdings ─────────────────────────────────────────────────────────

  async listHoldings(ctx: TenantContext, params: HoldingsQueryInput) {
    return withDb(ctx, async (client) => {
      const offset = (params.page - 1) * params.limit;
      const conds: string[] = ['h.group_id = $1'];
      const vals:  unknown[] = [ctx.groupId];
      if (!params.includeZero) conds.push(`h.quantity > 0`);
      if (params.memberId)     { conds.push(`h.member_id      = $${vals.length + 1}`); vals.push(params.memberId); }
      if (params.shareClassId) { conds.push(`h.share_class_id = $${vals.length + 1}`); vals.push(params.shareClassId); }

      const where = conds.join(' AND ');

      const [{ rows: cnt }, { rows: items }] = await Promise.all([
        client.query<{ count: string }>(`SELECT COUNT(*) AS count FROM share_holdings h WHERE ${where}`, vals),
        client.query<ShareHolding>(
          `SELECT h.*,
                  m.first_name AS member_first_name,
                  m.last_name  AS member_last_name,
                  m.phone      AS member_phone,
                  c.name       AS share_class_name,
                  c.code       AS share_class_code,
                  c.par_value     AS share_class_par,
                  c.current_value AS share_class_current
             FROM share_holdings h
             JOIN members       m ON m.id = h.member_id
             JOIN share_classes c ON c.id = h.share_class_id
            WHERE ${where}
            ORDER BY h.quantity DESC, m.first_name ASC
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

  async getGroupSummary(ctx: TenantContext): Promise<GroupShareSummary> {
    return withDb(ctx, async (client) => {
      const [classesQ, holdersQ, perClassQ, topQ] = await Promise.all([
        client.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM share_classes WHERE group_id = $1 AND is_active = TRUE`,
          [ctx.groupId],
        ),
        client.query<{ count: string }>(
          `SELECT COUNT(DISTINCT member_id) AS count
             FROM share_holdings WHERE group_id = $1 AND quantity > 0`,
          [ctx.groupId],
        ),
        client.query<{
          class_id: string; code: string; name: string;
          shares_issued: string; shareholders: string;
          effective_value: string;
          capital_at_value: string;
        }>(
          `SELECT c.id   AS class_id,
                  c.code AS code,
                  c.name AS name,
                  COALESCE(SUM(h.quantity), 0)::text                       AS shares_issued,
                  COUNT(DISTINCT h.member_id) FILTER (WHERE h.quantity > 0)::text AS shareholders,
                  COALESCE(c.current_value, c.par_value)::text             AS effective_value,
                  (COALESCE(SUM(h.quantity), 0) * COALESCE(c.current_value, c.par_value))::text AS capital_at_value
             FROM share_classes c
        LEFT JOIN share_holdings h ON h.share_class_id = c.id AND h.group_id = c.group_id
            WHERE c.group_id = $1
            GROUP BY c.id, c.code, c.name, c.par_value, c.current_value
            ORDER BY capital_at_value DESC NULLS LAST`,
          [ctx.groupId],
        ),
        client.query<{
          member_id: string; first_name: string; last_name: string;
          total_shares: string; total_invested: string;
        }>(
          `SELECT h.member_id,
                  m.first_name,
                  m.last_name,
                  SUM(h.quantity)::text       AS total_shares,
                  SUM(h.total_invested)::text AS total_invested
             FROM share_holdings h
             JOIN members m ON m.id = h.member_id
            WHERE h.group_id = $1 AND h.quantity > 0
            GROUP BY h.member_id, m.first_name, m.last_name
            ORDER BY total_shares DESC
            LIMIT 5`,
          [ctx.groupId],
        ),
      ]);

      const byClass = perClassQ.rows.map((r) => ({
        classId:        r.class_id,
        code:           r.code,
        name:           r.name,
        sharesIssued:   parseInt(r.shares_issued, 10),
        shareholders:   parseInt(r.shareholders, 10),
        effectiveValue: r.effective_value,
        capitalAtValue: r.capital_at_value,
      }));

      const totalShares       = byClass.reduce((s, c) => s + c.sharesIssued, 0);
      const totalShareCapital = byClass
        .reduce((s, c) => s + Number(c.capitalAtValue || 0), 0)
        .toFixed(2);
      const totalInvested = topQ.rows
        .reduce((s, r) => s + Number(r.total_invested || 0), 0)
        .toFixed(2);

      return {
        totalClasses:      parseInt(classesQ.rows[0].count, 10),
        totalShareholders: parseInt(holdersQ.rows[0].count, 10),
        totalShares,
        totalShareCapital,
        totalInvested,
        byClass,
        topHolders: topQ.rows.map((r) => ({
          memberId:      r.member_id,
          firstName:     r.first_name,
          lastName:      r.last_name,
          totalShares:   parseInt(r.total_shares, 10),
          totalInvested: r.total_invested,
        })),
      };
    });
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────

async function assertGroupMembership(client: PoolClient, groupId: string, memberId: string, field: string): Promise<void> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM group_members WHERE group_id = $1 AND member_id = $2`,
    [groupId, memberId],
  );
  if (!rows[0]) throw new ValidationError(`${field} (${memberId}) is not a member of this group`);
}

async function getMemberBalance(client: PoolClient, groupId: string, memberId: string, classId: string): Promise<number> {
  const { rows } = await client.query<{ quantity: number }>(
    `SELECT quantity FROM share_holdings
      WHERE group_id = $1 AND member_id = $2 AND share_class_id = $3`,
    [groupId, memberId, classId],
  );
  return rows[0]?.quantity ?? 0;
}

/**
 * Most recent acquisition timestamp for a (member, class) pair. Used by the
 * lock-period guard so members can't bypass it with throwaway outflows.
 */
async function getLastAcquisitionAt(
  client:  PoolClient,
  groupId: string,
  memberId: string,
  classId: string,
): Promise<Date | null> {
  const { rows } = await client.query<{ last_acq: string | null }>(
    `SELECT MAX(posted_at) AS last_acq
       FROM share_transactions
      WHERE group_id = $1
        AND member_id = $2
        AND share_class_id = $3
        AND status = 'posted'
        AND type IN ('purchase', 'allocation', 'transfer_in')`,
    [groupId, memberId, classId],
  );
  return rows[0]?.last_acq ? new Date(rows[0].last_acq) : null;
}

async function allocateSerial(client: PoolClient, groupId: string, classCode: string): Promise<string> {
  const { rows } = await client.query<{ allocate_share_certificate_serial: string }>(
    `SELECT allocate_share_certificate_serial($1, $2)`,
    [groupId, classCode],
  );
  return rows[0].allocate_share_certificate_serial;
}

interface TxnInsertArgs {
  group_id:                string;
  member_id:               string;
  share_class_id:          string;
  type:                    'allocation' | 'purchase' | 'transfer_in' | 'transfer_out' | 'redemption' | 'adjustment';
  quantity:                number;
  unit_price:              number;
  total_amount:            number;
  counterparty_member_id:  string | null;
  payment_method:          string | null;
  payment_reference:       string | null;
  certificate_serial:      string | null;
  notes:                   string | null;
  created_by:              string;
  posted_at:               string;
  reverses_transaction_id?: string | null;
}

async function insertTxn(client: PoolClient, a: TxnInsertArgs): Promise<ShareTransaction> {
  const { rows } = await client.query<ShareTransaction>(
    `INSERT INTO share_transactions (
       group_id, member_id, share_class_id, type, status,
       quantity, unit_price, total_amount,
       counterparty_member_id, payment_method, payment_reference,
       certificate_serial, notes, created_by, posted_at,
       reverses_transaction_id
     ) VALUES (
       $1,$2,$3,$4::share_txn_type,'posted',
       $5,$6,$7,
       $8,$9,$10,
       $11,$12,$13,$14,
       $15
     ) RETURNING *`,
    [
      a.group_id, a.member_id, a.share_class_id, a.type,
      a.quantity, a.unit_price.toFixed(2), a.total_amount.toFixed(2),
      a.counterparty_member_id, a.payment_method, a.payment_reference,
      a.certificate_serial, a.notes, a.created_by, a.posted_at,
      a.reverses_transaction_id ?? null,
    ],
  );
  return rows[0];
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
     VALUES ($1, $2, $3, 'share', $4, $5::jsonb)`,
    [ctx.groupId, ctx.userId, action, resourceId, JSON.stringify(payload)],
  );
}
