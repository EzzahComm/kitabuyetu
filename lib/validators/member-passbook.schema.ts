import { z } from 'zod';

export const MemberPassbookQuerySchema = z.object({
  page:      z.coerce.number().int().min(1).default(1),
  limit:     z.coerce.number().int().min(1).max(100).default(20),
  direction: z.enum(['in', 'out']).optional(),
});

export type MemberPassbookQueryInput = z.infer<typeof MemberPassbookQuerySchema>;
