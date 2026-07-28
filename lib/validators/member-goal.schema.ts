import { z } from 'zod';

export const CreateMemberGoalSchema = z.object({
  name:         z.string().min(1).max(100),
  emoji:        z.string().min(1).max(8).default('🎯'),
  targetAmount: z.coerce.number().positive(),
  deadline:     z.string().date().optional().nullable(),
});

export const UpdateMemberGoalSchema = z.object({
  name:         z.string().min(1).max(100).optional(),
  emoji:        z.string().min(1).max(8).optional(),
  targetAmount: z.coerce.number().positive().optional(),
  deadline:     z.string().date().optional().nullable(),
  status:       z.enum(['active', 'achieved', 'archived']).optional(),
});

export const LogGoalProgressSchema = z.object({
  amount: z.coerce.number().positive(),
});

export type CreateMemberGoalInput = z.infer<typeof CreateMemberGoalSchema>;
export type UpdateMemberGoalInput = z.infer<typeof UpdateMemberGoalSchema>;
export type LogGoalProgressInput  = z.infer<typeof LogGoalProgressSchema>;
