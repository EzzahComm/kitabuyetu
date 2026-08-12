/**
 * Client → server payload contract tests.
 *
 * Motivation: three separate UI actions shipped payloads their route schema
 * rejects outright, so the button 400'd on every click for every user and
 * nothing caught it — not tsc, not eslint, not the 361-test suite:
 *
 *   1. welfare "Quick review → Approve" sent `amountApproved: 0` against
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
import { StkPushSchema } from '@/lib/validators/mpesa.schema';
import { ReviewWelfareRequestSchema } from '@/lib/services/welfare.service';
import {
  ApplyLoanSchema, RejectLoanSchema, DisburseLoanSchema, RecordRepaymentSchema,
} from '@/lib/validators/loan.schema';
import { ChangePasswordSchema } from '@/lib/validators/auth.schema';

describe('client payload contracts', () => {
  describe('accounting: POST /accounting/journals', () => {
    // Mirrors what (dashboard)/accounting/page.tsx#handleSubmitJournal builds.
    const payload = {
      entryDate:   '2026-08-04',
      description: 'Bank charges for July',
      lines: [
        { accountId: '11111111-1111-4111-8111-111111111111', debit: 500, credit: 0, description: null },
        { accountId: '22222222-2222-4222-8222-222222222222', debit: 0, credit: 500, description: null },
      ],
    };

    it('accepts the payload the journal form builds', () => {
      expect(CreateJournalSchema.safeParse(payload).success).toBe(true);
    });

    it('rejects the old {memo, lines} shape that shipped', () => {
      const { entryDate: _d, description: _desc, ...rest } = payload;
      const legacy = { memo: 'Bank charges for July', ...rest };
      expect(CreateJournalSchema.safeParse(legacy).success).toBe(false);
    });

    it('rejects a single-line entry, which the row-remove button could produce', () => {
      expect(CreateJournalSchema.safeParse({ ...payload, lines: [payload.lines[0]] }).success).toBe(false);
    });

    it('rejects an unbalanced entry', () => {
      const lines = [payload.lines[0], { ...payload.lines[1], credit: 499 }];
      expect(CreateJournalSchema.safeParse({ ...payload, lines }).success).toBe(false);
    });
  });

  describe('mpesa: POST /mpesa/stk-push', () => {
    // Mirrors (dashboard)/billing/page.tsx#handleMpesaPay.
    const subscription = {
      phone:            '0712345678',
      amount:           300,
      accountReference: 'SUBSCRIPT',
      description:      'Growth plan',
      purpose:          'subscription' as const,
      planType:         'growth' as const,
      product:          'kitabu_yetu' as const,
    };

    it('accepts the billing page subscription payload', () => {
      expect(StkPushSchema.safeParse(subscription).success).toBe(true);
    });

    it('rejects a subscription payment that does not say which plan it buys', () => {
      // Migration 138: the M-Pesa callback activates the plan named here.
      // accountReference is the constant 'SUBSCRIPT' and description is 20
      // chars of free text, so without these the callback cannot know what was
      // bought and the payment strands — which is exactly what used to happen.
      const { planType: _p, product: _pr, ...noPlan } = subscription;
      expect(StkPushSchema.safeParse(noPlan).success).toBe(false);
    });

    it('rejects buying the negotiated enterprise tier through self-serve STK', () => {
      expect(StkPushSchema.safeParse({
        ...subscription, planType: 'enterprise',
      }).success).toBe(false);
    });

    it('does not require a plan for non-subscription purposes', () => {
      expect(StkPushSchema.safeParse({
        phone: '0712345678', amount: 500,
        accountReference: 'SMSTOPUP', description: 'SMS credits top-up',
        purpose: 'sms_topup',
      }).success).toBe(true);
    });

    it('accepts the contribution payload from StkPromptDialog', () => {
      expect(StkPushSchema.safeParse({
        phone: '0712345678', amount: 100,
        accountReference: 'CONTRIB', description: 'Contribution', purpose: 'contribution',
      }).success).toBe(true);
    });

    it('rejects the shape that shipped: no accountReference/description, free-text purpose', () => {
      expect(StkPushSchema.safeParse({
        phone: '0712345678', amount: 2500, purpose: 'Growth plan subscription',
      }).success).toBe(false);
    });

    it('rejects a description longer than the 20-char M-Pesa limit', () => {
      expect(StkPushSchema.safeParse({ ...subscription, description: 'x'.repeat(21) }).success).toBe(false);
    });
  });

  describe('welfare: POST /welfare/[id] review', () => {
    it('accepts an explicit positive approved amount', () => {
      expect(ReviewWelfareRequestSchema.safeParse({ action: 'approve', amountApproved: 5000 }).success).toBe(true);
    });

    it('accepts approve with the amount omitted (server falls back to amount_requested)', () => {
      expect(ReviewWelfareRequestSchema.safeParse({ action: 'approve' }).success).toBe(true);
    });

    it('rejects amountApproved: 0 — the value the approve button used to send', () => {
      expect(ReviewWelfareRequestSchema.safeParse({ action: 'approve', amountApproved: 0 }).success).toBe(false);
    });
  });

  describe('loans: the loan detail/list page payloads', () => {
    it('accepts an application with loanTermMonths (the form used to send termMonths)', () => {
      expect(ApplyLoanSchema.safeParse({
        principalAmount: 50000, interestRate: 10, loanTermMonths: 12, purpose: 'School fees',
      }).success).toBe(true);
    });

    it('rejects the termMonths spelling that shipped', () => {
      expect(ApplyLoanSchema.safeParse({
        principalAmount: 50000, interestRate: 10, termMonths: 12, purpose: 'School fees',
      }).success).toBe(false);
    });

    it('accepts memberId so an officer can apply on behalf of a member', () => {
      expect(ApplyLoanSchema.safeParse({
        memberId: '33333333-3333-4333-8333-333333333333',
        principalAmount: 50000, interestRate: 10, loanTermMonths: 12,
      }).success).toBe(true);
    });

    it('rejects a reject with no reason — what the Reject button used to send', () => {
      expect(RejectLoanSchema.safeParse({}).success).toBe(false);
      expect(RejectLoanSchema.safeParse({ reason: 'Insufficient savings history' }).success).toBe(true);
    });

    it('rejects a disburse with no date/method — what the Mark disbursed button used to send', () => {
      expect(DisburseLoanSchema.safeParse({}).success).toBe(false);
      expect(DisburseLoanSchema.safeParse({
        disbursementDate: '2026-08-04', paymentMethod: 'cash', mpesaReceiptNumber: null,
      }).success).toBe(true);
    });

    it('accepts the rebuilt repayment payload and rejects the old {amount, reference} one', () => {
      expect(RecordRepaymentSchema.safeParse({
        installmentNumber: 1, amountPaid: 5000, paymentDate: '2026-08-04',
        paymentMethod: 'mpesa', mpesaReceiptNumber: null, penaltyAmount: 0,
      }).success).toBe(true);
      expect(RecordRepaymentSchema.safeParse({
        amount: 5000, paymentMethod: 'mpesa', reference: 'ABC123',
      }).success).toBe(false);
    });
  });

  describe('accounting: posting-template overrides', () => {
    const lines = [
      { accountCode: '1001', side: 'debit'  as const, amount: 'amount' },
      { accountCode: '3001', side: 'credit' as const, amount: 'amount' },
    ];

    // These two are in posting-templates.service.ts's PostingEvent union and in
    // the list the UI renders, but were missing from this enum — so the UI
    // offered them and the request 400'd.
    it.each(['loan_disbursement', 'loan_repayment'])('accepts the %s event', (event) => {
      expect(SetPostingTemplateSchema.safeParse({ event, lines }).success).toBe(true);
    });

    it('still rejects an unknown event', () => {
      expect(SetPostingTemplateSchema.safeParse({ event: 'not_an_event', lines }).success).toBe(false);
    });
  });

  describe('auth: change password', () => {
    it('accepts what the settings form now sends', () => {
      expect(ChangePasswordSchema.safeParse({
        currentPassword: 'oldpass', newPassword: 'NewPass123',
      }).success).toBe(true);
    });

    it('rejects the shape the settings form used to send to PATCH /members/[id]', () => {
      expect(ChangePasswordSchema.safeParse({
        currentPassword: 'oldpass', password: 'NewPass123',
      }).success).toBe(false);
    });

    it('enforces the uppercase + digit rules', () => {
      expect(ChangePasswordSchema.safeParse({ currentPassword: 'x', newPassword: 'alllowercase1' }).success).toBe(false);
      expect(ChangePasswordSchema.safeParse({ currentPassword: 'x', newPassword: 'NoDigitsHere' }).success).toBe(false);
    });
  });
});
