import { z } from 'zod';

export const DIVIDEND_STATUSES = [
  'draft', 'pending_approval', 'approved', 'paid', 'cancelled',
] as const;

// Note: 'weighted' is reserved in the DB enum but the service rejects it
// until E5.2 ships the multi-factor computation. Keeping it out of the
// validator means the UI never offers it.
export const DIVIDEND_POLICY_TYPES = [
  'proportional_to_shares', 'flat_per_member',
] as const;

export const ALLOCATION_STATUSES = [
  'pending', 'paid', 'reinvested', 'cancelled',
] as const;

export const PAYMENT_METHODS = [
  'mpesa', 'cash', 'bank_transfer', 'cheque', 'other',
] as const;

export const CreateDividendDeclarationSchema = z.object({
  periodLabel:         z.string().min(2).max(60),
  periodStart:         z.string().date('periodStart must be YYYY-MM-DD'),
  periodEnd:           z.string().date('periodEnd must be YYYY-MM-DD'),
  poolAmount:          z.coerce.number().positive('Pool amount must be greater than zero'),
  policyType:          z.enum(DIVIDEND_POLICY_TYPES).default('proportional_to_shares'),
  policyConfig:        z.record(z.string(), z.unknown()).default({}),
  shareClassIds:       z.array(z.string().uuid()).default([]),
  withholdingTaxRate:  z.coerce.number().min(0).max(0.9999).default(0),
  notes:               z.string().max(1000).optional().nullable(),
}).refine(
  (v) => new Date(v.periodEnd) >= new Date(v.periodStart),
  { path: ['periodEnd'], message: 'periodEnd must be on or after periodStart' },
);

// Patch shape — only safe fields are mutable while the declaration is still
// 'draft'. Service rejects edits on non-draft declarations.
export const UpdateDividendDeclarationSchema = z.object({
  periodLabel:        z.string().min(2).max(60).optional(),
  periodStart:        z.string().date().optional(),
  periodEnd:          z.string().date().optional(),
  poolAmount:         z.coerce.number().positive().optional(),
  policyType:         z.enum(DIVIDEND_POLICY_TYPES).optional(),
  policyConfig:       z.record(z.string(), z.unknown()).optional(),
  shareClassIds:      z.array(z.string().uuid()).optional(),
  withholdingTaxRate: z.coerce.number().min(0).max(0.9999).optional(),
  notes:              z.string().max(1000).optional().nullable(),
});

export const DividendQuerySchema = z.object({
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(DIVIDEND_STATUSES).optional(),
});

export const CancelDeclarationSchema = z.object({
  reason: z.string().min(3).max(500),
});

export const PayAllocationSchema = z.object({
  paymentMethod:    z.enum(PAYMENT_METHODS),
  paymentReference: z.string().max(80).optional().nullable(),
  notes:            z.string().max(500).optional().nullable(),
});

export const BulkPayAllocationsSchema = z.object({
  allocationIds:    z.array(z.string().uuid()).min(1).max(500),
  paymentMethod:    z.enum(PAYMENT_METHODS),
  paymentReference: z.string().max(80).optional().nullable(),
  notes:            z.string().max(500).optional().nullable(),
});

export type CreateDividendDeclarationInput = z.infer<typeof CreateDividendDeclarationSchema>;
export type UpdateDividendDeclarationInput = z.infer<typeof UpdateDividendDeclarationSchema>;
export type DividendQueryInput             = z.infer<typeof DividendQuerySchema>;
export type CancelDeclarationInput         = z.infer<typeof CancelDeclarationSchema>;
export type PayAllocationInput             = z.infer<typeof PayAllocationSchema>;
export type BulkPayAllocationsInput        = z.infer<typeof BulkPayAllocationsSchema>;
export type DividendStatus                 = (typeof DIVIDEND_STATUSES)[number];
export type DividendPolicyType             = (typeof DIVIDEND_POLICY_TYPES)[number];
