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
});

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
