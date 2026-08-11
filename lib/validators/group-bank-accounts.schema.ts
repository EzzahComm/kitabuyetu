import { z } from 'zod';

export const CreateGroupBankAccountSchema = z.object({
  bankName:      z.string().min(1).max(200),
  shortcode:     z.string().min(1).max(20),
  accountNumber: z.string().min(1).max(50),
  label:         z.string().max(200).optional(),
  notes:         z.string().max(1000).optional(),
});
export type CreateGroupBankAccountInput = z.input<typeof CreateGroupBankAccountSchema>;

export const BankAccountActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('activate') }),
  z.object({ action: z.literal('reject'),  reason: z.string().min(1).max(500) }),
  z.object({ action: z.literal('disable'), reason: z.string().min(1).max(500).optional() }),
]);
export type BankAccountActionInput = z.infer<typeof BankAccountActionSchema>;
