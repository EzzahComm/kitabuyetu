import { z } from 'zod';
import { isValidKenyanPhone } from '@/lib/utils/phone';

/**
 * Mirrors the DB's own `vendor_payments_dest_chk` CHECK constraint: a B2C
 * payment needs a phone, a B2B payment needs a shortcode + account. A
 * discriminated union rejects the invalid combination at the API boundary
 * instead of letting it reach Postgres as a constraint violation.
 */
export const CreateVendorPaymentSchema = z.discriminatedUnion('channel', [
  z.object({
    channel:            z.literal('b2c'),
    payeeName:          z.string().min(1).max(200),
    payeePhone:         z.string().refine(isValidKenyanPhone, 'Invalid Kenyan phone number'),
    amount:             z.number().positive(),
    expenseAccountCode: z.string().regex(/^\d{4}$/).optional(),
    description:        z.string().max(1000).optional(),
  }),
  z.object({
    channel:            z.literal('b2b'),
    payeeName:          z.string().min(1).max(200),
    payeeShortcode:     z.string().min(3).max(20),
    payeeAccount:       z.string().min(1).max(50),
    amount:             z.number().positive(),
    expenseAccountCode: z.string().regex(/^\d{4}$/).optional(),
    description:        z.string().max(1000).optional(),
  }),
]);
export type CreateVendorPaymentPayload = z.input<typeof CreateVendorPaymentSchema>;

export const VendorPaymentActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('reject'), reason: z.string().min(5).max(500) }),
]);
export type VendorPaymentActionInput = z.infer<typeof VendorPaymentActionSchema>;
