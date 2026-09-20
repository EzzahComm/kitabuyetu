import { z } from 'zod';
import { HR_EMPLOYMENT_TYPES } from './hr.schema';

export const JOB_APPLICATION_STAGES = ['applied', 'screening', 'interview', 'offer', 'hired', 'rejected'] as const;

export const SubmitApplicationSchema = z.object({
  jobSlug: z.string().trim().min(1, 'jobSlug is required'),
  jobTitle: z.string().trim().min(1, 'jobTitle is required'),
  applicantName: z.string().trim().min(1, 'Name is required').max(200),
  applicantEmail: z.string().trim().toLowerCase().email('Enter a valid email address'),
  applicantPhone: z.string().trim().min(1).max(30).optional(),
  coverNote: z.string().trim().max(5000).optional(),
});
export type SubmitApplicationInput = z.infer<typeof SubmitApplicationSchema>;

export const UpdateApplicationStageSchema = z.object({
  stage: z.enum(['screening', 'interview', 'offer', 'rejected']),
  notes: z.string().trim().max(2000).optional(),
});
export type UpdateApplicationStageInput = z.infer<typeof UpdateApplicationStageSchema>;

export const HireApplicantSchema = z.object({
  department: z.string().trim().min(1).max(100).optional(),
  jobTitle: z.string().trim().min(1).max(150).optional(),
  employmentType: z.enum(HR_EMPLOYMENT_TYPES).default('full_time'),
  hireDate: z.string().date('Enter a valid hire date (YYYY-MM-DD)'),
  managerId: z.string().uuid().optional(),
});
export type HireApplicantInput = z.infer<typeof HireApplicantSchema>;
