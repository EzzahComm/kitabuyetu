/**
 * Configurable loan charges/fees engine (migration 179). Closes the gap
 * identified against loans.service.ts / loan-policy.service.ts: loans could
 * only carry a manually-typed `penalty_amount` on a repayment — no
 * configurable fee catalogue (processing fee, insurance fee, …), no automatic
 * late-fee computation, and nothing posted a charge to the GL on its own.
 *
 * Two halves:
 *
 *   - loan_charge_types: the CONFIGURED catalogue. Cascades Platform ->
 *     Organization -> Group with the same specificity rule as
 *     configuration.service.ts's resolvePolicyDetailed (group beats
 *     organization beats platform-wide NULL/NULL), but reimplemented at the
 *     row level here rather than delegated to that resolver — see
 *     20260917010000_174_loan_charges_engine.sql's header for why this is a
 *     sibling table to `policies`, not a new key inside it (loan_charges needs
 *     a stable foreign key to "the configuration that produced this charge",
 *     which a single opaque JSONB value per scope cannot offer). The
 *     specificity math itself is identical; getEffectiveChargeTypes below is
 *     the analogue of loan-policy.service.ts's getEffectiveLoanTerms.
 *
 *   - loan_charges: the ledger. applyDisbursementCharges/applyOverdueCharges
 *     are the two hooks loans.service.ts calls, from inside its OWN
 *     transaction, at the exact points a charge should fire (disburse() /
 *     recordRepayment()) — every charge is therefore atomic with the state
 *     change that triggered it. Every application posts to the GL via
 *     posting-templates.service.ts's 'loan_charge' event, never a bespoke
 *     insert, so a tenant can remap which account a fee lands in exactly like
 *     every other posted event.
 */
import type { PoolClient } from 'pg';
import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { NotFoundError, ValidationError, ConflictError } from '@/lib/utils/errors';
import { postTemplatedJournal } from './posting-templates.service';
import type { PolicySource } from './configuration.service';
import type { LoanChargeType, LoanCharge } from '@/types/db.types';
import type {
  ConfigureChargeTypeInput, LoanChargeCalculationType, LoanChargeTriggerEvent,
} from '@/lib/validators/loan-charge.schema';

const toDateString = (d: string | Date): string => (typeof d === 'string' ? d : d.toISOString().slice(0, 10));

// ─── Resolution (cascade read) ───────────────────────────────────────────────

export interface EffectiveChargeType {
  id:              string;
  name:            string;
  calculationType: LoanChargeCalculationType;
  /** Percentage rate (0-100) or a flat KES amount, per calculationType. */
  amount:          number;
  triggerEvent:    LoanChargeTriggerEvent;
  isActive:        boolean;
  source:          PolicySource;
}

/**
 * Resolves, per distinct charge name, the most specific ACTIVE row visible at
 * this scope — group beats organization beats platform-wide (both NULL),
 * mirroring resolvePolicyDetailed's specificity rule applied per-row via
 * DISTINCT ON instead of over one JSONB value. An inactive row never shadows
 * a lower tier's active one: it simply does not participate, and the cascade
 * falls through to the next active row for that name (or to nothing, which
 * correctly means "no such charge configured here").
 *
 * Used inline by the loans.service.ts hooks below (filtered by triggerEvent)
 * and by loanChargesService.listChargeTypes (unfiltered, for the config UI).
 */
export async function getEffectiveChargeTypes(
  client:       PoolClient,
  scope:        { organizationId?: string | null; groupId?: string | null },
  triggerEvent?: LoanChargeTriggerEvent,
): Promise<EffectiveChargeType[]> {
  const { rows } = await client.query<{
    id: string; name: string; calculation_type: LoanChargeCalculationType;
    amount: string; trigger_event: LoanChargeTriggerEvent; is_active: boolean; specificity: number;
  }>(
    `SELECT DISTINCT ON (lower(btrim(name)))
       id, name, calculation_type, amount, trigger_event, is_active,
       CASE WHEN group_id IS NOT NULL THEN 2 WHEN organization_id IS NOT NULL THEN 1 ELSE 0 END AS specificity
     FROM loan_charge_types
     WHERE is_active
       AND ($3::loan_charge_trigger_event IS NULL OR trigger_event = $3)
       AND (
         (organization_id IS NULL AND group_id IS NULL)
         OR (group_id = $2)
         OR (organization_id = $1)
         OR (group_id IS NULL AND organization_id IN (
               SELECT oga.organization_id FROM organization_group_access oga
               WHERE oga.group_id = $2 AND oga.is_active
             ))
       )
     ORDER BY lower(btrim(name)), specificity DESC`,
    [scope.organizationId ?? null, scope.groupId ?? null, triggerEvent ?? null],
  );
  return rows.map((r) => ({
    id:              r.id,
    name:            r.name,
    calculationType: r.calculation_type,
    amount:          parseFloat(r.amount),
    triggerEvent:    r.trigger_event,
    isActive:        r.is_active,
    source:          r.specificity === 2 ? 'group' : r.specificity === 1 ? 'organization' : 'platform',
  }));
}

function computeChargeAmount(calculationType: LoanChargeCalculationType, configured: number, principal: number): number {
  const raw = calculationType === 'percentage' ? (principal * configured) / 100 : configured;
  return Math.round(raw * 100) / 100;
}

// ─── Application (write path — called from loans.service.ts hooks) ──────────

/**
 * Applies one resolved charge type to one loan (on-disburse) or one specific
 * overdue instalment (on-overdue), posts the GL entry, and audit-logs it.
 * Internal — never called from a route directly, only from the two
 * orchestration hooks below, which loans.service.ts calls from within its own
 * transaction so a charge and the state change that triggered it commit or
 * roll back together.
 *
 * Idempotent by construction: a pre-check against the same uniqueness the DB
 * enforces (loan_charges_unique_per_loan_ondisburse /
 * _unique_per_repayment) means a retried disburse()/recordRepayment() call
 * (or, for on_overdue, recordRepayment() ever being reachable more than once
 * for the same instalment) never double-charges. Returns null rather than a
 * row when the charge was already applied, or when it resolves to zero.
 */
async function applyCharge(
  client: PoolClient,
  ctx:    TenantContext,
  args: {
    loanId:           string;
    chargeType:       EffectiveChargeType;
    principal:        number;
    loanRepaymentId?: string | null;
    entryDate:        string;
  },
): Promise<LoanCharge | null> {
  const amount = computeChargeAmount(args.chargeType.calculationType, args.chargeType.amount, args.principal);
  if (amount <= 0) return null;

  const { rows: existing } = await client.query<{ id: string }>(
    args.loanRepaymentId
      ? `SELECT id FROM loan_charges WHERE loan_repayment_id = $1 AND charge_type_id = $2`
      : `SELECT id FROM loan_charges WHERE loan_id = $1 AND charge_type_id = $2 AND loan_repayment_id IS NULL`,
    [args.loanRepaymentId ?? args.loanId, args.chargeType.id],
  );
  if (existing[0]) return null;

  // Same lookup idiom as postLoanDisbursementJournal/postLoanRepaymentJournal
  // (posting-templates.service.ts): resolve member/membership from whichever
  // row actually triggered this charge, for journal tagging.
  const { rows: refRows } = await client.query<{ member_id: string | null; group_membership_id: string | null }>(
    args.loanRepaymentId
      ? `SELECT member_id, group_membership_id FROM loan_repayments WHERE id = $1`
      : `SELECT member_id, group_membership_id FROM loans WHERE id = $1`,
    [args.loanRepaymentId ?? args.loanId],
  );

  const { rows } = await client.query<LoanCharge>(
    `INSERT INTO loan_charges (group_id, loan_id, charge_type_id, loan_repayment_id, amount)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [ctx.groupId, args.loanId, args.chargeType.id, args.loanRepaymentId ?? null, amount.toFixed(2)],
  );
  let charge = rows[0];

  const jeId = await postTemplatedJournal(
    client, ctx.groupId, ctx.userId, 'loan_charge',
    `${args.chargeType.name} — loan ${args.loanId}`,
    { amount },
    {
      reference:         charge.id,
      memberId:          refRows[0]?.member_id ?? undefined,
      groupMembershipId: refRows[0]?.group_membership_id ?? undefined,
      entryDate:         args.entryDate,
    },
  );

  if (jeId) {
    const { rows: updated } = await client.query<LoanCharge>(
      `UPDATE loan_charges SET journal_entry_id = $1 WHERE id = $2 RETURNING *`,
      [jeId, charge.id],
    );
    charge = updated[0];
  }

  await writeAuditLog(client, ctx, 'loan_charge.applied', charge.id, undefined, {
    loan_id: args.loanId, charge_type_id: args.chargeType.id, charge_type_name: args.chargeType.name,
    trigger: args.loanRepaymentId ? 'on_overdue' : 'on_disburse',
    amount: charge.amount, journal_entry_id: charge.journal_entry_id,
  });

  return charge;
}

/**
 * Hook for loans.service.ts's disburse(): applies every effective on_disburse
 * charge type (processing fee, insurance fee, …) once, the moment a loan
 * transitions to 'disbursed'. A no-op when the group has none configured —
 * which is every group today, since nothing seeds a default (see migration
 * 174's header).
 */
export async function applyDisbursementCharges(
  client: PoolClient,
  ctx:    TenantContext,
  loan:   { id: string; principal_amount: string; disbursement_date: Date | string | null },
): Promise<void> {
  const chargeTypes = await getEffectiveChargeTypes(
    client, { organizationId: ctx.organizationId ?? null, groupId: ctx.groupId }, 'on_disburse',
  );
  if (chargeTypes.length === 0) return;

  const principal = parseFloat(loan.principal_amount);
  const entryDate = toDateString(loan.disbursement_date ?? new Date());
  for (const chargeType of chargeTypes) {
    await applyCharge(client, ctx, { loanId: loan.id, chargeType, principal, loanRepaymentId: null, entryDate });
  }
}

/**
 * Hook for loans.service.ts's recordRepayment(): when the instalment being
 * recorded is overdue (paid after its due_date), applies every effective
 * on_overdue charge type (late payment fee, …) for THAT instalment. Parallel
 * to, not a replacement for, the existing manual `penalty_amount` field on
 * loan_repayments — an officer can still type a one-off penalty; this adds
 * the automatic mechanism that never existed.
 */
export async function applyOverdueCharges(
  client:  PoolClient,
  ctx:     TenantContext,
  loan:    { id: string; principal_amount: string },
  installment: { id: string; due_date: Date | string },
  asOfDate: string,
): Promise<void> {
  const dueDate = toDateString(installment.due_date);
  if (asOfDate <= dueDate) return; // paid on or before the due date — not overdue

  const chargeTypes = await getEffectiveChargeTypes(
    client, { organizationId: ctx.organizationId ?? null, groupId: ctx.groupId }, 'on_overdue',
  );
  if (chargeTypes.length === 0) return;

  const principal = parseFloat(loan.principal_amount);
  for (const chargeType of chargeTypes) {
    await applyCharge(client, ctx, {
      loanId: loan.id, chargeType, principal, loanRepaymentId: installment.id, entryDate: asOfDate,
    });
  }
}

// ─── Route-facing service ────────────────────────────────────────────────────

export const loanChargesService = {
  /** Effective charge-type catalogue for the caller's group, cascade-resolved. Any authenticated member may read (mirrors GET /loans/policy). */
  async listChargeTypes(ctx: TenantContext): Promise<EffectiveChargeType[]> {
    return withDb(ctx, async (client) => {
      return getEffectiveChargeTypes(client, { organizationId: ctx.organizationId ?? null, groupId: ctx.groupId });
    });
  },

  /**
   * Create or update a GROUP-level charge type (admin-only — gated at the
   * route via loans.policy.manage, the same chairperson-tier permission that
   * already guards the group's lending-terms override). Supplying `id`
   * updates that row; it must already belong to the caller's group.
   * Platform/organization-tier rows exist in the schema for the cascade but
   * are not exposed here — no super-admin/organization-coordinator tooling
   * was asked for in this round; the group tier covers the real use case
   * (a group configuring its own fee schedule).
   */
  async configureChargeType(ctx: TenantContext, input: ConfigureChargeTypeInput): Promise<LoanChargeType> {
    return withTransaction(ctx, async (client) => {
      try {
        if (input.id) {
          const { rows: existing } = await client.query<LoanChargeType>(
            `SELECT * FROM loan_charge_types WHERE id = $1 AND group_id = $2 AND organization_id IS NULL FOR UPDATE`,
            [input.id, ctx.groupId],
          );
          if (!existing[0]) throw new NotFoundError('Loan charge type', input.id);
          const prev = existing[0];

          const { rows } = await client.query<LoanChargeType>(
            `UPDATE loan_charge_types
             SET name = $1, calculation_type = $2, amount = $3, trigger_event = $4, is_active = $5, updated_at = NOW()
             WHERE id = $6 RETURNING *`,
            [input.name, input.calculationType, input.amount.toFixed(4), input.triggerEvent, input.isActive, input.id],
          );
          const updated = rows[0];
          await writeAuditLog(client, ctx, 'loan_charge_type.update', updated.id, { ...prev }, { ...updated });
          return updated;
        }

        const { rows } = await client.query<LoanChargeType>(
          `INSERT INTO loan_charge_types (group_id, name, calculation_type, amount, trigger_event, is_active, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [ctx.groupId, input.name, input.calculationType, input.amount.toFixed(4), input.triggerEvent, input.isActive, ctx.userId],
        );
        const created = rows[0];
        await writeAuditLog(client, ctx, 'loan_charge_type.create', created.id, undefined, { ...created });
        return created;
      } catch (err: unknown) {
        const e = err as { code?: string; constraint?: string };
        if (e?.code === '23505' && e?.constraint === 'loan_charge_types_active_scope_unique') {
          throw new ConflictError(`A charge type named '${input.name}' already exists for this group`);
        }
        throw err;
      }
    });
  },

  /**
   * Officer action (loans.approve — same bar as approve/disburse/writeOff):
   * forgives a still-pending charge. Reverses whichever account the group's
   * 'loan_charge' template resolved to at application time (posting an
   * inverted copy of that same event), so a waived fee never leaves revenue
   * overstated — only a 'pending' charge can be waived; one already paid or
   * already waived is left alone.
   */
  async waiveCharge(ctx: TenantContext, chargeId: string, reason: string): Promise<LoanCharge> {
    return withTransaction(ctx, async (client) => {
      const { rows: existing } = await client.query<LoanCharge>(
        `SELECT * FROM loan_charges WHERE id = $1 AND group_id = $2 FOR UPDATE`,
        [chargeId, ctx.groupId],
      );
      if (!existing[0]) throw new NotFoundError('Loan charge', chargeId);
      const prev = existing[0];
      if (prev.status !== 'pending') {
        throw new ValidationError(`Only a pending charge can be waived (current status: '${prev.status}')`);
      }

      if (prev.journal_entry_id) {
        const { rows: loanRows } = await client.query<{ member_id: string | null; group_membership_id: string | null }>(
          `SELECT member_id, group_membership_id FROM loans WHERE id = $1`, [prev.loan_id],
        );
        await postTemplatedJournal(
          client, ctx.groupId, ctx.userId, 'loan_charge',
          `Waived charge reversal — ${chargeId}`,
          { amount: parseFloat(prev.amount) },
          {
            reference: chargeId,
            invert:    true,
            memberId:          loanRows[0]?.member_id ?? undefined,
            groupMembershipId: loanRows[0]?.group_membership_id ?? undefined,
          },
        );
      }

      const { rows } = await client.query<LoanCharge>(
        `UPDATE loan_charges
         SET status = 'waived', waived_by = $1, waived_at = NOW(), waived_reason = $2
         WHERE id = $3 RETURNING *`,
        [ctx.userId, reason, chargeId],
      );
      const updated = rows[0];
      await writeAuditLog(client, ctx, 'loan_charge.waived', chargeId, { status: prev.status }, { status: updated.status, reason });
      return updated;
    });
  },

  /** Every charge ever applied to a loan, most recent first. */
  async listChargesForLoan(ctx: TenantContext, loanId: string): Promise<(LoanCharge & { charge_type_name: string })[]> {
    return withDb(ctx, async (client) => {
      const { rows: loanRows } = await client.query(`SELECT id FROM loans WHERE id = $1 AND group_id = $2`, [loanId, ctx.groupId]);
      if (!loanRows[0]) throw new NotFoundError('Loan', loanId);

      const { rows } = await client.query<LoanCharge & { charge_type_name: string }>(
        `SELECT lc.*, lct.name AS charge_type_name
         FROM loan_charges lc JOIN loan_charge_types lct ON lct.id = lc.charge_type_id
         WHERE lc.loan_id = $1 AND lc.group_id = $2
         ORDER BY lc.applied_at DESC`,
        [loanId, ctx.groupId],
      );
      return rows;
    });
  },
};

async function writeAuditLog(
  client: PoolClient,
  ctx:    TenantContext,
  action: string,
  resourceId: string,
  oldValues?: Record<string, unknown>,
  newValues?: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
     VALUES ($1, $2, $3, 'loan_charge', $4, $5, $6)`,
    [
      ctx.groupId,
      ctx.userId,
      action,
      resourceId,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
    ],
  );
}
