import { z } from 'zod';

/**
 * Configurable loan charges/fees engine (migration 179). Mirrors this
 * codebase's other Zod conventions (see loan.schema.ts): server-side *Input
 * aliases via z.infer, client-facing *Payload aliases via z.input for any
 * schema carrying a `.default()`.
 */

export const LOAN_CHARGE_CALCULATION_TYPES = ['fixed', 'percentage'] as const;
export const LOAN_CHARGE_TRIGGER_EVENTS    = ['on_disburse', 'on_overdue'] as const;

export type LoanChargeCalculationType = (typeof LOAN_CHARGE_CALCULATION_TYPES)[number];
export type LoanChargeTriggerEvent    = (typeof LOAN_CHARGE_TRIGGER_EVENTS)[number];

/**
 * Create-or-update a group-level charge type. Supplying `id` updates that
 * row (must already belong to the caller's group); omitting it creates a new
 * one. calculationType/amount are cross-validated: a percentage rate cannot
 * exceed 100, matching loan_charge_types_amount_bounded's DB CHECK so a bad
 * value 400s here rather than surfacing as a raw constraint violation.
 */
export const ConfigureChargeTypeSchema = z.object({
  id:              z.string().uuid().optional(),
  name:            z.string().trim().min(2).max(100),
  calculationType: z.enum(LOAN_CHARGE_CALCULATION_TYPES),
  amount:          z.number().nonnegative(),
  triggerEvent:    z.enum(LOAN_CHARGE_TRIGGER_EVENTS),
  isActive:        z.boolean().optional().default(true),
}).superRefine((v, ctx) => {
  if (v.calculationType === 'percentage' && v.amount > 100) {
    ctx.addIssue({
      code: 'custom', path: ['amount'],
      message: 'A percentage charge cannot exceed 100',
    });
  }
});

export const WaiveChargeSchema = z.object({
  chargeId: z.string().uuid(),
  reason:   z.string().min(5).max(500),
});

export type ConfigureChargeTypeInput = z.infer<typeof ConfigureChargeTypeSchema>;
export type WaiveChargeInput         = z.infer<typeof WaiveChargeSchema>;

export type ConfigureChargeTypePayload = z.input<typeof ConfigureChargeTypeSchema>;
export type WaiveChargePayload         = z.input<typeof WaiveChargeSchema>;
