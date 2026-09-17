import { z } from 'zod';

/**
 * Budget tracking (migration 173, lib/services/budget.service.ts). A budget
 * is a real financial record — planned amounts per real GL account
 * (public.accounts), for one group, over one fiscal period — compared
 * against actual activity already posted to the double-entry ledger
 * (journal_entries/journal_lines). It is not a policy, so it does not go
 * through configuration.service.ts's cascading resolver.
 */

export const BUDGET_STATUSES = ['draft', 'active', 'closed'] as const;
export type BudgetStatus = (typeof BUDGET_STATUSES)[number];

export const BudgetLineInputSchema = z.object({
  accountId:     z.string().uuid(),
  plannedAmount: z.number().nonnegative(),
  notes:         z.string().max(500).optional().nullable(),
});

// One appearance per account per budget — mirrors LoanFundingPlanSchema's
// identical rule in lib/validators/loan.schema.ts. A second planned amount
// for the same account has nowhere sensible to go; combine it into one line.
const noDuplicateAccounts = (lines: { accountId: string }[]) =>
  new Set(lines.map((l) => l.accountId)).size === lines.length;

export const CreateBudgetSchema = z.object({
  name:         z.string().min(2).max(255),
  periodStart:  z.string().date(),
  periodEnd:    z.string().date(),
  status:       z.enum(BUDGET_STATUSES).optional(),
  notes:        z.string().max(1000).optional().nullable(),
  lines:        z.array(BudgetLineInputSchema)
                  .min(1, 'A budget needs at least one line')
                  .max(200)
                  .refine(noDuplicateAccounts, {
                    message: 'An account can only appear once per budget — combine the amounts instead',
                  }),
}).refine(
  (v) => v.periodEnd >= v.periodStart,
  { message: 'periodEnd must not be before periodStart', path: ['periodEnd'] },
);

// All fields optional — the service fills in whatever is omitted from the
// existing row before re-validating the period range, since periodStart and
// periodEnd may each be supplied independently of the other.
export const UpdateBudgetSchema = z.object({
  name:         z.string().min(2).max(255).optional(),
  periodStart:  z.string().date().optional(),
  periodEnd:    z.string().date().optional(),
  status:       z.enum(BUDGET_STATUSES).optional(),
  notes:        z.string().max(1000).optional().nullable(),
  // When present, REPLACES the full set of lines (not a partial patch) —
  // simplest correct semantics for a small, officer-edited list.
  lines:        z.array(BudgetLineInputSchema)
                  .min(1, 'A budget needs at least one line')
                  .max(200)
                  .refine(noDuplicateAccounts, {
                    message: 'An account can only appear once per budget — combine the amounts instead',
                  })
                  .optional(),
}).refine(
  (v) => Object.values(v).some((val) => val !== undefined),
  { message: 'No fields to update' },
);

export const BudgetQuerySchema = z.object({
  page:     z.coerce.number().int().min(1).default(1),
  limit:    z.coerce.number().int().min(1).max(100).default(20),
  status:   z.enum(BUDGET_STATUSES).optional(),
  sortDir:  z.enum(['asc', 'desc']).default('desc'),
});

export type BudgetLineInput  = z.infer<typeof BudgetLineInputSchema>;
export type CreateBudgetInput = z.infer<typeof CreateBudgetSchema>;
export type UpdateBudgetInput = z.infer<typeof UpdateBudgetSchema>;
export type BudgetQueryInput  = z.infer<typeof BudgetQuerySchema>;

// Client request-body types. z.input, not z.infer: a field carrying
// .default() is optional on the wire but present after parsing, so the
// server-side *Input aliases above are the wrong shape for a caller.
export type CreateBudgetPayload = z.input<typeof CreateBudgetSchema>;
export type UpdateBudgetPayload = z.input<typeof UpdateBudgetSchema>;
