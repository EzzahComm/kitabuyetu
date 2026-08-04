import { z } from 'zod';

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
  interestRate:     z.number().min(0).max(100),
  loanTermMonths:   z.number().int().min(1).max(120),
  purpose:          z.string().max(500).optional().nullable(),
  guarantorId:      z.string().uuid().optional().nullable(),
});

export const ApproveLoanSchema = z.object({
  notes: z.string().max(500).optional().nullable(),
});

export const RejectLoanSchema = z.object({
  reason: z.string().min(5).max(500),
});

export const DisburseLoanSchema = z.object({
  disbursementDate:    z.string().date(),
  paymentMethod:       z.enum(['mpesa', 'cash', 'bank_transfer', 'cheque', 'standing_order']),
  mpesaReceiptNumber:  z.string().max(50).optional().nullable(),
  notes:               z.string().max(500).optional().nullable(),
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
  interestRate:   z.coerce.number().min(0).max(100),
  interestMethod: z.enum(['flat', 'reducing_balance']),
  maxTermMonths:  z.coerce.number().int().min(1).max(120),
  loanMultiplier: z.coerce.number().positive(),
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
