import { z } from 'zod';

export const CreateSettlementSchema = z.object({
  bankAccountId: z.string().uuid(),
  amount:        z.number().positive(),
  notes:         z.string().max(1000).optional(),
});
export type CreateSettlementPayload = z.input<typeof CreateSettlementSchema>;

export const SettlementActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('reject'), reason: z.string().min(5).max(500) }),
]);
export type SettlementActionInput = z.infer<typeof SettlementActionSchema>;
