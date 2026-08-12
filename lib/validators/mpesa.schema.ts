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
export const StkPushSchema = z.object({
  phone:            z.string().refine(isValidKenyanPhone, 'Invalid phone number'),
  amount:           z.number().int().positive('Amount must be a positive integer (whole shillings)'),
  accountReference: z.string().min(1).max(12),
  description:      z.string().min(1).max(20),
  invoiceId:        z.string().uuid().optional().nullable(),
  purpose:          z.enum(['registration', 'subscription', 'sms_topup', 'contribution']),
  // Which plan is being bought. `enterprise` is intentionally absent: it is
  // negotiated, not self-serve, and must never be activated by a payment
  // whose amount the payer chose. The M-Pesa callback refuses it too — this
  // is the first of the two gates, not the only one.
  planType:         z.enum(['starter', 'growth', 'premium']).optional(),
  product:          z.enum(['kitabu_yetu', 'chama_reminder']).optional(),
}).refine(
  (v) => v.purpose !== 'subscription' || (!!v.planType && !!v.product),
  {
    message: 'planType and product are required when purpose is "subscription"',
    path:    ['planType'],
  },
);

export type StkPushInput = z.infer<typeof StkPushSchema>;

/** Same reasoning as StkPushSchema — moved out of the route so the client can
 *  be typed against it. `commandId` has a default, so `z.input` is the correct
 *  payload type here: callers may legitimately omit it. */
export const B2CSchema = z.object({
  phone:     z.string().refine(isValidKenyanPhone, 'Invalid Kenyan phone number'),
  amount:    z.number().int().positive(),
  occasion:  z.string().min(1).max(100),
  commandId: z.enum(['BusinessPayment', 'SalaryPayment', 'PromotionPayment'])
               .default('BusinessPayment'),
  loanId:    z.string().uuid().optional(),
});

export type B2CInput = z.input<typeof B2CSchema>;
