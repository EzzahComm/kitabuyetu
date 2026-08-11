import { z } from 'zod';

export const CreateAccountSchema = z.object({
  accountCode: z.string().min(1).max(20),
  name:        z.string().min(2).max(255),
  type:        z.enum(['asset', 'liability', 'equity', 'income', 'expense']),
  parentId:    z.string().uuid().optional().nullable(),
  description: z.string().max(500).optional().nullable(),
});

export const UpdateAccountSchema = z.object({
  name:        z.string().min(2).max(255).optional(),
  description: z.string().max(500).optional().nullable(),
  isActive:    z.boolean().optional(),
});

const JournalLineSchema = z.object({
  accountId:   z.string().uuid(),
  debit:       z.number().min(0).default(0),
  credit:      z.number().min(0).default(0),
  description: z.string().max(255).optional().nullable(),
}).refine(
  (l) => (l.debit > 0) !== (l.credit > 0),
  { message: 'Each line must have either a debit or credit, not both' },
);

export const CreateJournalSchema = z.object({
  entryDate:   z.string().date(),
  reference:   z.string().max(100).optional().nullable(),
  description: z.string().min(3).max(500),
  lines:       z.array(JournalLineSchema).min(2, 'A journal entry needs at least 2 lines'),
}).refine(
  (e) => {
    const debits  = e.lines.reduce((s, l) => s + l.debit,  0);
    const credits = e.lines.reduce((s, l) => s + l.credit, 0);
    return Math.abs(debits - credits) < 0.01;
  },
  { message: 'Journal entry is unbalanced: debits must equal credits' },
);

export const VoidJournalSchema = z.object({
  reason: z.string().min(5).max(500),
});

export const ReportQuerySchema = z.object({
  from: z.string().date(),
  to:   z.string().date(),
});

export const BalanceSheetQuerySchema = z.object({
  asOf: z.string().date().optional(),
});

export const ClosePeriodSchema = z.object({
  periodStart: z.string().date(),
  periodEnd:   z.string().date(),
}).refine((p) => p.periodEnd >= p.periodStart, { message: 'periodEnd must not be before periodStart' });

export const ReopenPeriodSchema = z.object({
  reason: z.string().min(5).max(500),
});

export const SetApprovalPolicySchema = z.object({
  key:       z.enum(['journal_threshold', 'group_disbursement_threshold', 'org_disbursement_threshold']),
  threshold: z.number().nonnegative().max(1_000_000_000),
});

// Posting-template override (§29.9) — structure is further locked to the
// event's default shape by posting-templates.service.ts; this only checks form.
export const SetPostingTemplateSchema = z.object({
  // Must stay in step with posting-templates.service.ts's PostingEvent union.
  // It drifted: commit c10b1ee added loan_disbursement/loan_repayment to that
  // union (and to DEFAULT_TEMPLATES, and to the Policies-tab list the UI
  // renders from it) but not to this enum — so picking either of those two
  // events in the UI produced a 400 no override could get past.
  event: z.enum([
    'share_purchase', 'share_redemption', 'welfare_disbursement',
    'welfare_pool_contribution', 'dividend_declaration', 'dividend_payment',
    'subscription_payment', 'loan_writeoff',
    'loan_disbursement', 'loan_repayment',
    'settlement_sweep', 'vendor_payment',
  ]),
  lines: z.array(z.object({
    accountCode: z.string().regex(/^\d{4}$/),
    side:        z.enum(['debit', 'credit']),
    amount:      z.string().min(1).max(40),
  })).min(2).max(10),
});

export type CreateAccountInput  = z.infer<typeof CreateAccountSchema>;
export type UpdateAccountInput  = z.infer<typeof UpdateAccountSchema>;
// Now also the client's payload type: the accounting page used to post
// `{ memo, lines }` against this schema's required `entryDate` + `description`,
// so every "Post journal" click 400'd. Nothing caught it because
// accountingApi.createJournal took `body: unknown` — it is typed against this
// now, so a drifting payload is a compile error rather than a runtime 400.
export type CreateJournalInput  = z.infer<typeof CreateJournalSchema>;
export type VoidJournalInput    = z.infer<typeof VoidJournalSchema>;
export type ReportQueryInput    = z.infer<typeof ReportQuerySchema>;
export type ClosePeriodInput    = z.infer<typeof ClosePeriodSchema>;
export type ReopenPeriodInput   = z.infer<typeof ReopenPeriodSchema>;
export type SetApprovalPolicyInput = z.infer<typeof SetApprovalPolicySchema>;
export type SetPostingTemplateInput = z.infer<typeof SetPostingTemplateSchema>;

// Client request-body types. z.input, not z.infer: a field carrying
// .default() is optional on the wire but present after parsing, so the
// server-side *Input aliases above are the wrong shape for a caller.
export type CreateAccountPayload = z.input<typeof CreateAccountSchema>;
export type SetPostingTemplatePayload = z.input<typeof SetPostingTemplateSchema>;
export type CreateJournalPayload = z.input<typeof CreateJournalSchema>;
