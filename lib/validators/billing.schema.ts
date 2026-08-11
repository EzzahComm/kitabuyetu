import { z } from 'zod';

export const UpgradePlanSchema = z.object({
  planType: z.enum(['starter', 'growth', 'enterprise']),
  // Migration 127. Optional and defaulted so every existing client body
  // ({ planType }) keeps upgrading the Kitabu Yetu subscription exactly as it
  // did; plan tiers are scoped within a product, not across them.
  product:  z.enum(['kitabu_yetu', 'chama_reminder']).default('kitabu_yetu'),
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

// Client request-body types. z.input, not z.infer: a field carrying
// .default() is optional on the wire but present after parsing, so the
// server-side *Input aliases above are the wrong shape for a caller.
export type RecordManualPaymentPayload = z.input<typeof RecordManualPaymentSchema>;
