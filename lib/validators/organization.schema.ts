import { z } from 'zod';

// Shared with app/api/v1/organization/programs/route.ts and
// app/api/v1/organization/disbursements/route.ts — a single source so a
// client dropdown can never drift from what the server actually accepts
// (this file used to have three independent copies of DISBURSEMENT_TYPES
// and two of PROGRAM_TYPES, one of them missing 'insurance'/'investment').
export const PROGRAM_TYPES = [
  'grant', 'revolving_fund', 'loan_capital', 'matching_contribution',
  'seed_capital', 'emergency_support', 'operational_support',
  'scholarship', 'insurance', 'investment',
] as const;

export const DISBURSEMENT_TYPES = [
  'grant', 'revolving_fund', 'loan_capital', 'matching_contribution',
  'seed_capital', 'emergency_support', 'operational_support',
] as const;

// ─── Financial product terms (capital layer Phase 1, migration 116) ──────────
// Every vocabulary below mirrors a CHECK constraint on funding_programs. Keep
// them in lockstep: the DB is the real enforcement, these exist so a bad
// payload returns a clean 400 instead of a raw 23514 from Postgres.

/** Matches loans_interest_method_check EXACTLY — not the source spec's 'declining_balance'. */
export const INTEREST_METHODS    = ['flat', 'reducing_balance'] as const;
export const REPAYMENT_FREQUENCIES = ['none', 'weekly', 'monthly', 'quarterly', 'bullet'] as const;
export const CAPITAL_MODELS      = ['liability', 'pass_through'] as const;
export const LOSS_BEARERS        = ['group', 'organization', 'shared'] as const;
export const REVENUE_OWNERS      = ['organization', 'group', 'shared'] as const;
export const MEMBER_VISIBILITIES = ['pseudonymous', 'aggregate', 'identified'] as const;

/** Waterfall components, in the order a repayment is applied. */
export const WATERFALL_COMPONENTS = ['penalty', 'interest', 'principal'] as const;

// Stored verbatim as jsonb and read by the Phase 4 engine, so this keeps the
// source spec's snake_case document shape rather than the camelCase used for
// columns — it is a config document, not a row.
export const RepaymentWaterfallSchema = z.object({
  order: z.array(z.enum(WATERFALL_COMPONENTS)).min(1)
    .refine((o) => new Set(o).size === o.length, 'waterfall order cannot repeat a component'),
  revenue_split: z.record(
    z.object({ organization: z.number().min(0).max(1), group: z.number().min(0).max(1) })
      .refine((s) => Math.abs(s.organization + s.group - 1) < 1e-9, 'each revenue_split must sum to exactly 1.0'),
  ).optional(),
  rounding: z.enum(['banker', 'half_up']).optional(),
  residual: z.enum(['group_retained', 'organization_retained']).optional(),
});

const productTerms = {
  productCode:         z.string().min(2).max(40).optional(),
  isRepayable:         z.boolean().optional(),
  capitalModel:        z.enum(CAPITAL_MODELS).optional(),
  lossBearer:          z.enum(LOSS_BEARERS).optional(),
  sharedLossRatio:     z.number().min(0).max(1).optional(),
  interestMethod:      z.enum(INTEREST_METHODS).optional(),
  /** PERCENTAGE (12.5 = 12.5%), matching loans.interest_rate — never a 0-1 ratio. */
  interestRateAnnual:  z.number().min(0).max(999.99).optional(),
  repaymentFrequency:  z.enum(REPAYMENT_FREQUENCIES).optional(),
  gracePeriodDays:     z.number().int().min(0).max(3650).optional(),
  tenorMonths:         z.number().int().positive().max(600).optional(),
  revenueOwner:        z.enum(REVENUE_OWNERS).optional(),
  revenueShareRatio:   z.number().min(0).max(1).optional(),
  repaymentWaterfall:  RepaymentWaterfallSchema.optional(),
  memberVisibility:    z.enum(MEMBER_VISIBILITIES).optional(),
};

export const CreateProgramSchema = z.object({
  name:                  z.string().min(3).max(160),
  programType:           z.enum(PROGRAM_TYPES),
  budget:                z.number().positive().max(100_000_000_000),
  fundingSource:         z.string().max(160).optional(),
  description:           z.string().max(2000).optional(),
  eligibilityCriteria:   z.record(z.unknown()).optional(),
  geographicCoverage:    z.array(z.string().max(80)).max(100).optional(),
  reportingRequirements: z.string().max(2000).optional(),
  startsOn:              z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endsOn:                z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ...productTerms,
}).superRefine((v, ctx) => {
  // Mirrors funding_programs_repayable_shape / _non_repayable_shape exactly.
  if (v.isRepayable) {
    if (!v.repaymentFrequency || v.repaymentFrequency === 'none') {
      ctx.addIssue({ code: 'custom', path: ['repaymentFrequency'], message: 'A repayable product needs a repayment frequency' });
    }
    if (v.tenorMonths === undefined) {
      ctx.addIssue({ code: 'custom', path: ['tenorMonths'], message: 'A repayable product needs a tenor' });
    }
    if (!v.interestMethod) {
      ctx.addIssue({ code: 'custom', path: ['interestMethod'], message: 'A repayable product needs an interest method' });
    }
    if (!v.repaymentWaterfall) {
      ctx.addIssue({ code: 'custom', path: ['repaymentWaterfall'], message: 'A repayable product needs a repayment waterfall' });
    }
  } else {
    if (v.interestRateAnnual !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['interestRateAnnual'], message: 'A non-repayable product cannot carry interest' });
    }
    if (v.interestMethod) {
      ctx.addIssue({ code: 'custom', path: ['interestMethod'], message: 'A non-repayable product cannot have an interest method' });
    }
    if (v.tenorMonths !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['tenorMonths'], message: 'A non-repayable product cannot have a tenor' });
    }
    if (v.repaymentFrequency && v.repaymentFrequency !== 'none') {
      ctx.addIssue({ code: 'custom', path: ['repaymentFrequency'], message: 'A non-repayable product cannot have a repayment frequency' });
    }
  }

  // Mirrors funding_programs_revenue_share_shape / _shared_loss_shape.
  if (v.revenueOwner === 'shared' && v.revenueShareRatio === undefined) {
    ctx.addIssue({ code: 'custom', path: ['revenueShareRatio'], message: "revenueShareRatio is required when revenueOwner is 'shared'" });
  }
  if (v.revenueOwner !== 'shared' && v.revenueShareRatio !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['revenueShareRatio'], message: "revenueShareRatio is only valid when revenueOwner is 'shared'" });
  }
  if (v.lossBearer === 'shared' && v.sharedLossRatio === undefined) {
    ctx.addIssue({ code: 'custom', path: ['sharedLossRatio'], message: "sharedLossRatio is required when lossBearer is 'shared'" });
  }
  if (v.lossBearer !== 'shared' && v.sharedLossRatio !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['sharedLossRatio'], message: "sharedLossRatio is only valid when lossBearer is 'shared'" });
  }

  // Reserved-but-unimplemented paths (impact-report.md §7). Rejected at the
  // edge so a caller gets a clear message rather than a half-working feature.
  if (v.capitalModel === 'pass_through') {
    ctx.addIssue({ code: 'custom', path: ['capitalModel'], message: "capitalModel 'pass_through' is reserved and not implemented" });
  }
  if (v.lossBearer && v.lossBearer !== 'group') {
    ctx.addIssue({ code: 'custom', path: ['lossBearer'], message: `lossBearer '${v.lossBearer}' is reserved and not implemented` });
  }
  if (v.memberVisibility && v.memberVisibility !== 'pseudonymous') {
    ctx.addIssue({
      code: 'custom', path: ['memberVisibility'],
      message: "memberVisibility beyond 'pseudonymous' is a product and legal decision under the Kenya DPA, not a config change",
    });
  }
});

/** Capitalize / decapitalize a product — adjusts its spending authority (budget). */
export const CapitalAdjustmentSchema = z.object({
  amount:    z.number().positive('Amount must be positive').max(100_000_000_000),
  reference: z.string().max(64).optional(),
  notes:     z.string().max(500).optional(),
});

export const ProgramActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('capitalize'),   ...CapitalAdjustmentSchema.shape }),
  z.object({ action: z.literal('decapitalize'), ...CapitalAdjustmentSchema.shape }),
]);

/**
 * PATCH /programs/:id body. Lifted out of that route file so it stops being a
 * route-private duplicate — the drift this file exists to prevent. Payload
 * shape is unchanged, so the Funding Portal's pause/reactivate keeps working.
 */
export const UpdateProgramStatusSchema = z.object({
  status: z.enum(['active', 'paused', 'closed']),
});

export const DepositSchema = z.object({
  amount:    z.number().positive('Amount must be positive').max(1_000_000_000),
  source:    z.string().max(160).optional(),
  reference: z.string().max(64).optional(),
  notes:     z.string().max(500).optional(),
});

export const DisburseSchema = z.object({
  groupId:          z.string().uuid(),
  amount:           z.number().positive().max(1_000_000_000),
  disbursementType: z.enum(DISBURSEMENT_TYPES),
  fundingProgramId: z.string().uuid().optional(),
  notes:            z.string().max(500).optional(),
  /** What the allocation is for, e.g. "On-lending to members" (migration 117). */
  purpose:          z.string().max(500).optional(),
});

export const DisbursementActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('reject'), reason: z.string().min(5).max(500) }),
]);

export const BrandingSchema = z.object({
  logoUrl:      z.string().url().max(2048).optional().nullable(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex color like #16a34a').optional().nullable(),
});

export type DepositInput            = z.infer<typeof DepositSchema>;
export type CreateProgramInput      = z.infer<typeof CreateProgramSchema>;
export type CapitalAdjustmentInput  = z.infer<typeof CapitalAdjustmentSchema>;
export type ProgramActionInput      = z.infer<typeof ProgramActionSchema>;
export type UpdateProgramStatusInput = z.infer<typeof UpdateProgramStatusSchema>;
export type RepaymentWaterfall      = z.infer<typeof RepaymentWaterfallSchema>;
export type DisburseInput           = z.infer<typeof DisburseSchema>;
export type DisbursementActionInput = z.infer<typeof DisbursementActionSchema>;
export type BrandingInput           = z.infer<typeof BrandingSchema>;

// Client request-body types — z.input, not z.infer, matching this
// codebase's convention elsewhere (see accounting.schema.ts): none of the
// fields above carry a `.default()`, so these are currently identical to
// the *Input aliases, but kept distinct so a future default doesn't
// silently mistype every call site.
export type DepositPayload       = z.input<typeof DepositSchema>;
export type CreateProgramPayload = z.input<typeof CreateProgramSchema>;
export type CapitalAdjustmentPayload = z.input<typeof CapitalAdjustmentSchema>;
export type ProgramActionPayload     = z.input<typeof ProgramActionSchema>;
export type DisbursePayload      = z.input<typeof DisburseSchema>;
export type BrandingPayload      = z.input<typeof BrandingSchema>;
