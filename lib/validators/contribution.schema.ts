import { z } from 'zod';

export const CreateContributionSchema = z.object({
  memberId: z.string().uuid(),
  amount: z.number().positive('Amount must be positive'),
  contributionDate: z.string().date(),
  dueDate: z.string().date().optional().nullable(),
  paymentMethod: z.enum(['mpesa', 'cash', 'bank_transfer', 'cheque', 'standing_order']).optional().nullable(),
  mpesaReceiptNumber: z.string().max(50).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export const UpdateContributionSchema = z.object({
  status: z.enum(['pending', 'completed', 'failed', 'cancelled', 'overdue']).optional(),
  paymentMethod: z.enum(['mpesa', 'cash', 'bank_transfer', 'cheque', 'standing_order']).optional().nullable(),
  mpesaReceiptNumber: z.string().max(50).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export const ReconcileContributionSchema = z.object({
  mpesaReceiptNumber: z.string().min(1).max(50),
});

export const ContributionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  memberId: z.string().uuid().optional(),
  status: z.enum(['pending', 'completed', 'failed', 'cancelled', 'overdue']).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});

// SavingsPolicy 'limits' - advisory min/max/grace period (migration 092).
export const SetSavingsLimitsSchema = z.object({
  minContribution: z.coerce.number().min(0),
  maxContribution: z.coerce.number().positive().nullable(),
  gracePeriodDays: z.coerce.number().int().min(0),
});

// ContributionPlan 'amounts' - the group's flat expected monthly contribution
// and welfare amount (contribution-plan.service.ts). Unlike SavingsPolicy's
// min/max, these two ARE what notify_contribution_reminders uses to compute
// each member's outstanding balance/arrears, so 0 genuinely means "this
// group doesn't track that obligation" rather than "no limit".
export const SetContributionPlanSchema = z.object({
  monthlyContribution: z.coerce.number().min(0),
  welfareAmount: z.coerce.number().min(0),
});

export type CreateContributionInput = z.infer<typeof CreateContributionSchema>;
export type UpdateContributionInput = z.infer<typeof UpdateContributionSchema>;
export type ContributionQueryInput = z.infer<typeof ContributionQuerySchema>;
export type SetSavingsLimitsInput = z.infer<typeof SetSavingsLimitsSchema>;
export type SetContributionPlanInput = z.infer<typeof SetContributionPlanSchema>;

// Client request-body types. z.input, not z.infer: a field carrying
// .default() is optional on the wire but present after parsing, so the
// server-side *Input aliases above are the wrong shape for a caller.
export type CreateContributionPayload = z.input<typeof CreateContributionSchema>;
export type UpdateContributionPayload = z.input<typeof UpdateContributionSchema>;
export type SetSavingsLimitsPayload = z.input<typeof SetSavingsLimitsSchema>;
export type SetContributionPlanPayload = z.input<typeof SetContributionPlanSchema>;
