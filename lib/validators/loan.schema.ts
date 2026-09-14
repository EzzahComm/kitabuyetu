import { z } from 'zod';

/**
 * Repayment cadences a member loan can carry (migration 149).
 *
 * Spellings are borrowed, not invented: 'weekly'/'monthly'/'quarterly' match
 * REPAYMENT_FREQUENCIES on the organization side, and 'biweekly' matches the
 * meeting_frequency enum. The org list's 'none' and 'bullet' are excluded —
 * neither yields an amortisation schedule, and every loan must have one.
 *
 * Must stay in sync with loans_repayment_frequency_check.
 */
export const LOAN_REPAYMENT_FREQUENCIES = ['weekly', 'biweekly', 'monthly', 'quarterly'] as const;

export type LoanRepaymentFrequency = (typeof LOAN_REPAYMENT_FREQUENCIES)[number];

/** Instalments generated for a given term. Mirrors the migration-149 formula
 *  (ROUND(months * periods_per_year / 12), floored at 1) so the UI can preview
 *  a schedule without a round trip. */
export const PERIODS_PER_YEAR: Record<LoanRepaymentFrequency, number> = {
  weekly: 52, biweekly: 26, monthly: 12, quarterly: 4,
};

export function installmentCount(termMonths: number, freq: LoanRepaymentFrequency): number {
  return Math.max(1, Math.round((termMonths * PERIODS_PER_YEAR[freq]) / 12));
}

export const ApplyLoanSchema = z.object({
  /**
   * Borrower. Omit for a self-application; supply it to apply on behalf of
   * another member, which POST /loans gates on `loans.approve`.
   * Added because the loans page has always had a member picker whose value
   * the server discarded — apply() hardcoded ctx.userId, so an officer filling
   * the form for someone else would have silently created the loan against
   * themselves (it never got that far: the form also sent `termMonths`, so the
   * request 400'd before reaching the service).
   */
  memberId:         z.string().uuid().optional(),
  principalAmount:  z.number().positive(),
  /**
   * NOMINAL ANNUAL rate. The ceiling is 300, not 100, because migration 167
   * changed what this number means without moving the bound.
   *
   * 100 was generous for a monthly rate. Read annually it forbids ordinary
   * chama pricing: migration 148's own text calls 10% per month "the norm for
   * chama lending in this market", which is 120% a year — rejected with a 400.
   * The enterprise funding form already labels this field "annual %" and
   * placeholders it at 120, so the two surfaces disagreed about what was even
   * enterable. 300 (25%/month equivalent) stays well clear of real pricing
   * while still catching a fat-fingered 5000.
   */
  interestRate:     z.number().min(0).max(300),
  loanTermMonths:   z.number().int().min(1).max(120),
  /** Omit and the loan repays monthly — the only behaviour that existed before
   *  migration 149, so every existing caller keeps working unchanged. */
  repaymentFrequency: z.enum(LOAN_REPAYMENT_FREQUENCIES).optional(),
  purpose:          z.string().max(500).optional().nullable(),
  guarantorId:      z.string().uuid().optional().nullable(),
});

export const ApproveLoanSchema = z.object({
  notes: z.string().max(500).optional().nullable(),
});

export const RejectLoanSchema = z.object({
  reason: z.string().min(5).max(500),
});

/**
 * Which funding source(s) finance this loan, and how much from each
 * (migration 118). Omit it entirely and the loan is funded from the group's own
 * internal savings — the behaviour every existing caller already relies on.
 *
 * Amounts must sum to the loan principal; a deferred constraint trigger
 * enforces the same rule in the database, so this only exists to turn a
 * mismatch into a clean 400 rather than a raw 23514.
 */
export const LoanFundingPlanSchema = z.array(
  z.object({
    fundingSourceId: z.string().uuid(),
    amount:          z.number().positive(),
  }),
).min(1).max(10)
  .refine(
    (plan) => new Set(plan.map((p) => p.fundingSourceId)).size === plan.length,
    'A funding source can only appear once in a plan — combine the amounts instead',
  );

export const DisburseLoanSchema = z.object({
  disbursementDate:    z.string().date(),
  paymentMethod:       z.enum(['mpesa', 'cash', 'bank_transfer', 'cheque', 'standing_order']),
  mpesaReceiptNumber:  z.string().max(50).optional().nullable(),
  notes:               z.string().max(500).optional().nullable(),
  fundingPlan:         LoanFundingPlanSchema.optional(),
});

export const MarkDefaultedSchema = z.object({
  reason: z.string().min(5).max(500),
});

export const WriteOffLoanSchema = z.object({
  reason: z.string().min(5).max(500),
});

export const RecordRepaymentSchema = z.object({
  installmentNumber:   z.number().int().min(1),
  amountPaid:          z.number().positive(),
  paymentDate:         z.string().date(),
  paymentMethod:       z.enum(['mpesa', 'cash', 'bank_transfer', 'cheque', 'standing_order']),
  mpesaReceiptNumber:  z.string().max(50).optional().nullable(),
  penaltyAmount:       z.number().min(0).default(0),
});

export const LoanQuerySchema = z.object({
  page:     z.coerce.number().int().min(1).default(1),
  limit:    z.coerce.number().int().min(1).max(100).default(20),
  memberId: z.string().uuid().optional(),
  status:   z.enum(['pending','approved','rejected','disbursed','active','completed','defaulted','written_off']).optional(),
  from:     z.string().date().optional(),
  to:       z.string().date().optional(),
  sortDir:  z.enum(['asc', 'desc']).default('desc'),
});

// LoanPolicy 'terms' — advisory group lending defaults (migration 088).
export const SetLoanTermsSchema = z.object({
  /** NOMINAL ANNUAL rate — see the ceiling rationale on CreateLoanSchema. */
  interestRate:   z.coerce.number().min(0).max(300),
  interestMethod: z.enum(['flat', 'reducing_balance']),
  maxTermMonths:  z.coerce.number().int().min(1).max(120),
  loanMultiplier: z.coerce.number().positive(),
  /** The fixed durations offered, e.g. [1, 3, 6, 12]. Omitted means any term
   *  up to maxTermMonths — the behaviour before term options existed.
   *  Sorted here so the form renders them in order whatever was submitted. */
  termOptions:    z.array(z.coerce.number().int().min(1))
                   .min(1, 'List at least one term, or leave term options off entirely')
                   .max(12, 'That many term options is a product catalogue, not a policy')
                   .transform((v) => [...new Set(v)].sort((a, b) => a - b))
                   .optional(),
}).superRefine((v, ctx) => {
  // Mirrors validateLoanTerms() so the API returns a clean 400 rather than
  // letting the service throw after the request has been accepted.
  const over = (v.termOptions ?? []).filter((t) => t > v.maxTermMonths);
  if (over.length > 0) {
    ctx.addIssue({
      code: 'custom', path: ['termOptions'],
      message: `Term options ${over.join(', ')} exceed the maximum of ${v.maxTermMonths} months`,
    });
  }
});

// FinePolicy 'schedule' — advisory offence tariff (migration 088).
export const SetFineScheduleSchema = z.object({
  schedule: z.record(z.string().min(1), z.coerce.number().min(0)),
});

export type SetLoanTermsInput    = z.infer<typeof SetLoanTermsSchema>;
export type ApplyLoanInput       = z.infer<typeof ApplyLoanSchema>;
export type ApproveLoanInput     = z.infer<typeof ApproveLoanSchema>;
export type RejectLoanInput      = z.infer<typeof RejectLoanSchema>;
export type DisburseLoanInput    = z.infer<typeof DisburseLoanSchema>;
export type MarkDefaultedInput   = z.infer<typeof MarkDefaultedSchema>;
export type WriteOffLoanInput    = z.infer<typeof WriteOffLoanSchema>;
export type RecordRepaymentInput = z.infer<typeof RecordRepaymentSchema>;
export type LoanQueryInput       = z.infer<typeof LoanQuerySchema>;

/**
 * PATCH /api/v1/loans/[id] dispatches on `body.action` and then parses with one
 * of the five schemas above (which do not themselves carry the discriminant).
 * This union reconstructs the real wire shape so a call site cannot, say, send
 * `action: 'writeOff'` without the `reason` that action requires.
 */
export type LoanActionInput =
  | ({ action: 'approve'  } & ApproveLoanPayload)
  | ({ action: 'reject'   } & RejectLoanPayload)
  | ({ action: 'disburse' } & DisburseLoanPayload)
  | ({ action: 'default'  } & MarkDefaultedPayload)
  | ({ action: 'writeOff' } & WriteOffLoanPayload);

// Client request-body types. z.input, not z.infer: a field carrying
// .default() is optional on the wire but present after parsing, so the
// server-side *Input aliases above are the wrong shape for a caller.
export type ApplyLoanPayload = z.input<typeof ApplyLoanSchema>;
export type RecordRepaymentPayload = z.input<typeof RecordRepaymentSchema>;
export type SetLoanTermsPayload = z.input<typeof SetLoanTermsSchema>;
export type ApproveLoanPayload = z.input<typeof ApproveLoanSchema>;
export type RejectLoanPayload = z.input<typeof RejectLoanSchema>;
export type DisburseLoanPayload = z.input<typeof DisburseLoanSchema>;
export type MarkDefaultedPayload = z.input<typeof MarkDefaultedSchema>;
export type WriteOffLoanPayload = z.input<typeof WriteOffLoanSchema>;
