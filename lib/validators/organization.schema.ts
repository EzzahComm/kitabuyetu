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
export type DisbursePayload      = z.input<typeof DisburseSchema>;
export type BrandingPayload      = z.input<typeof BrandingSchema>;
