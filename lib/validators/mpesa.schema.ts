import { z } from 'zod';
import { isValidKenyanPhone } from '@/lib/utils/phone';

/**
 * Moved here out of `app/api/v1/mpesa/stk-push/route.ts` so the client can be
 * typed against the same definition the server validates with. It previously
 * lived as a private `const` inside the route, which meant nothing stopped
 * `(dashboard)/billing/page.tsx` from posting `{phone, amount, purpose}` with
 * `purpose` as free text — three violations of this schema at once, and the
 * M-Pesa subscription button 400'd on every click as a result. A route file
 * can only export HTTP handlers and route config, so the schema cannot be
 * exported from where it was.
 */
export const StkPushSchema = z
  .object({
    phone: z.string().refine(isValidKenyanPhone, 'Invalid phone number'),
    amount: z.number().int().positive('Amount must be a positive integer (whole shillings)'),
    accountReference: z.string().min(1).max(12),
    description: z.string().min(1).max(20),
    invoiceId: z.string().uuid().optional().nullable(),
    purpose: z.enum(['registration', 'subscription', 'sms_topup', 'contribution']),
    // Which plan is being bought. `enterprise` is intentionally absent: it is
    // negotiated, not self-serve, and must never be activated by a payment
    // whose amount the payer chose. The M-Pesa callback refuses it too — this
    // is the first of the two gates, not the only one.
    planType: z.enum(['starter', 'growth', 'premium']).optional(),
    product: z.enum(['kitabu_yetu', 'chama_reminder', 'changisha']).optional(),
    // Optional and defaulted server-side to 'monthly' (migration 155) — an
    // older client that doesn't know about cycles yet still works unchanged.
    billingCycle: z.enum(['monthly', 'quarterly', 'biannual', 'annual']).optional(),
  })
  .refine((v) => v.purpose !== 'subscription' || (!!v.planType && !!v.product), {
    message: 'planType and product are required when purpose is "subscription"',
    path: ['planType'],
  });

export type StkPushInput = z.infer<typeof StkPushSchema>;

/** Same reasoning as StkPushSchema — moved out of the route so the client can
 *  be typed against it. `commandId` has a default, so `z.input` is the correct
 *  payload type here: callers may legitimately omit it. */
export const B2CSchema = z.object({
  phone: z.string().refine(isValidKenyanPhone, 'Invalid Kenyan phone number'),
  amount: z.number().int().positive(),
  occasion: z.string().min(1).max(100),
  commandId: z.enum(['BusinessPayment', 'SalaryPayment', 'PromotionPayment']).default('BusinessPayment'),
  loanId: z.string().uuid().optional(),
});

export type B2CInput = z.input<typeof B2CSchema>;

// Group → member disbursement (migration 218). No phone field on purpose: an
// M-Pesa payout always goes to the member's registered number, resolved
// server-side.
export const MemberPayoutSchema = z
  .object({
    memberId: z.string().uuid(),
    // Whole shillings; M-Pesa B2C's per-transaction ceiling applies to every
    // method so one limit is shown to officers.
    amount: z.number().int('Amount must be whole shillings').positive('Amount must be greater than zero').max(250_000),
    purpose: z.enum(['savings_withdrawal', 'merry_go_round', 'other']),
    description: z.string().trim().min(3, 'Describe the purpose (3+ characters)').max(200),
    notes: z.string().trim().max(500).optional(),
    paymentMethod: z.enum(['mpesa', 'cash', 'bank_transfer']).default('mpesa'),
    paymentReference: z.string().trim().max(100).optional(),
  })
  .refine((v) => v.paymentMethod !== 'bank_transfer' || !!v.paymentReference, {
    message: 'A bank transfer needs the payee account / transfer reference',
    path: ['paymentReference'],
  });

export type MemberPayoutInput = z.input<typeof MemberPayoutSchema>;

export const MemberPayoutActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('reject'), reason: z.string().trim().min(5).max(500) }),
  z.object({ action: z.literal('cancel') }),
]);

export const MemberPayoutListSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z
    .enum([
      'pending_approval',
      'awaiting_platform',
      'approved',
      'rejected',
      'cancelled',
      'dispatched',
      'completed',
      'failed',
      'timed_out',
      'reconciled',
    ])
    .optional(),
  memberId: z.string().uuid().optional(),
  initiatedBy: z.string().uuid().optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
