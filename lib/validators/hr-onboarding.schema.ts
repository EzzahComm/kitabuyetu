import { z } from 'zod';

export const HR_ONBOARDING_TASK_STATUSES = ['pending', 'in_progress', 'done', 'skipped'] as const;

export const AddOnboardingTaskSchema = z.object({
  category: z.string().trim().min(1, 'Category is required').max(50),
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().trim().max(1000).optional(),
  dueDate: z.string().date('Enter a valid due date (YYYY-MM-DD)').optional(),
});
export type AddOnboardingTaskInput = z.infer<typeof AddOnboardingTaskSchema>;

export const UpdateOnboardingTaskSchema = z.object({
  status: z.enum(HR_ONBOARDING_TASK_STATUSES).optional(),
  dueDate: z.string().date('Enter a valid due date (YYYY-MM-DD)').nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type UpdateOnboardingTaskInput = z.infer<typeof UpdateOnboardingTaskSchema>;
