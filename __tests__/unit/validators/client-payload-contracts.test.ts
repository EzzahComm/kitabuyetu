/**
 * Client â†’ server payload contract tests.
 *
 * Motivation: three separate UI actions shipped payloads their route schema
 * rejects outright, so the button 400'd on every click for every user and
 * nothing caught it â€” not tsc, not eslint, not the 361-test suite:
 *
 *   1. welfare "Quick review â†’ Approve" sent `amountApproved: 0` against
 *      `.positive()`                                    (audit M3)
 *   2. accounting "Post journal" sent `{memo, lines}` against a schema
 *      requiring `entryDate` + `description`
 *   3. billing "Pay with M-Pesa" omitted `accountReference`/`description` and
 *      sent free text for the `purpose` enum
 *
 * Each was invisible because the API helper took `body: unknown`. Those three
 * helpers are now typed, which is the real guard; these tests pin the exact
 * payload shapes each screen builds so a future edit to either side fails here
 * rather than in production.
 */
import { CreateJournalSchema, SetPostingTemplateSchema } from '@/lib/validators/accounting.schema';
import { MemberPayoutSchema, StkPushSchema } from '@/lib/validators/mpesa.schema';
import {
  ReviewWelfareRequestSchema,
  RecordWelfarePoolSchema,
  DisburseWelfareSchema,
} from '@/lib/services/welfare.service';
import { ContributionCsvRowSchema } from '@/lib/validators/import.schema';
import {
  ApplyLoanSchema,
  RejectLoanSchema,
  DisburseLoanSchema,
  RecordRepaymentSchema,
} from '@/lib/validators/loan.schema';
import { ChangePasswordSchema } from '@¶»§q«^