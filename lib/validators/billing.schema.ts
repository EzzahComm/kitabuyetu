import { z } from 'zod';

export const UpgradePlanSchema = z.object({
  planType: z.enum(['starter', 'growth', 'enterprise']),
});

export const RecordManualPaymentSchema = z.object({
  invoiceId:     z.string().uuid().optional().nullable(),
  amount:        z.number().positive(),
  paymentMethod: z.enum(['mpesa', 'cash', 'bank_transfer', 'cheque', 'standing_order']),
  paymentDate:   z.string().datetime(),
  mpesaReceiptNumber: z.string().max(50).optional().nullable(),
  notes:         z.string().max(500).optional().nullable(),
});

export const SmsTopupSchema = z.object({
  amount: z.number().positive('Top-up amount must be positive'),
});

export const UpdateBillingAccountSchema = z.object({
  lowBalanceThreshold: z.number().min(0).optional(),
  autoTopupEnabled:    z.boolean().optional(),
  autoTopupAmount:     z.number().positive().optional().nullable(),
});

export type UpgradePlanInput             = z.infer<typeof UpgradePlanSchema>;
export type RecordManualPaymentInput     = z.infer<typeof RecordManualPaymentSchema>;
export type SmsTopupInput                = z.infer<typeof SmsTopupSchema>;
export type UpdateBillingAccountInput    = z.infer<typeof UpdateBillingAccountSchema>;
