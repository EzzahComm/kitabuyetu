import { z } from 'zod';

export const RequestWithdrawalSchema = z.object({
  grossAmount: z.number().positive(),
});
export type RequestWithdrawalPayload = z.input<typeof RequestWithdrawalSchema>;

export const WithdrawalActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('reject'), reason: z.string().min(5).max(500) }),
]);
export type WithdrawalActionInput = z.infer<typeof WithdrawalActionSchema>;
