import { z } from 'zod';

export const HR_EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'intern'] as const;
export const HR_EMPLOYMENT_STATUSES = ['active', 'on_leave', 'suspended', 'terminated'] as const;

export const CreateEmployeeSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  lastName: z.string().trim().min(1, 'Last name is required').max(100),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  phone: z.string().trim().min(1).max(30).optional(),
  department: z.string().trim().min(1).max(100).optional(),
  jobTitle: z.string().trim().min(1).max(150).optional(),
  employmentType: z.enum(HR_EMPLOYMENT_TYPES).default('full_time'),
  hireDate: z.string().date('Enter a valid hire date (YYYY-MM-DD)'),
  managerId: z.string().uuid().optional(),
  memberId: z.string().uuid().optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type CreateEmployeeInput = z.infer<typeof CreateEmployeeSchema>;

export const UpdateEmployeeSchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  department: z.string().trim().max(100).nullable().optional(),
  jobTitle: z.string().trim().max(150).nullable().optional(),
  employmentType: z.enum(HR_EMPLOYMENT_TYPES).optional(),
  managerId: z.string().uuid().nullable().optional(),
  memberId: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type UpdateEmployeeInput = z.infer<typeof UpdateEmployeeSchema>;

export const TerminateEmployeeSchema = z.object({
  terminationDate: z.string().date('Enter a valid termination date (YYYY-MM-DD)'),
  reason: z.string().trim().max(2000).optional(),
});
export type TerminateEmployeeInput = z.infer<typeof TerminateEmployeeSchema>;
