import { z } from 'zod';
import { isValidKenyanPhone } from '@/lib/utils/phone';

export const LoginSchema = z.object({
  phone:   z.string().refine(isValidKenyanPhone, 'Invalid Kenyan phone number'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  groupId: z.string().uuid('Invalid group ID'),
});

// Mirrors the public.register_group RPC signature + the v2 workflow spec.
// Phase D MVP — verification (email/SMS) fields will be added in Part 2.
export const RegisterSchema = z.object({
  // Group identity
  groupName: z.string().min(3, 'Group name must be at least 3 characters').max(255),
  groupType: z.enum(['chama', 'sacco', 'welfare', 'investment', 'ngo_group']),

  // Registrant identity
  firstName: z.string().min(2).max(100),
  lastName:  z.string().min(2).max(100),
  phone:     z.string().refine(isValidKenyanPhone, 'Invalid Kenyan phone number'),
  email:     z.string().email('Invalid email address').optional().nullable().or(z.literal('')),
  password:  z.string().min(8, 'Password must be at least 8 characters')
               .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
               .regex(/[0-9]/, 'Password must contain at least one number'),

  // Governance — the registrant must take one of the three mandatory roles (spec §2).
  creatorRole: z.enum(['chairperson', 'secretary', 'treasurer'], {
    errorMap: () => ({ message: 'Choose your role: chairperson, secretary, or treasurer' }),
  }),

  // Location — countyId is required (FK to counties); sub-county / ward fall
  // back to free text until the IEBC dataset is seeded into sub_counties/wards.
  countyId:        z.string().uuid('County is required'),
  subCountyText:   z.string().max(80).optional().or(z.literal('')),
  wardText:        z.string().max(100).optional().or(z.literal('')),
  villageEstate:   z.string().max(200).optional().or(z.literal('')),

  // Purpose + cadence
  primaryObjective: z.enum([
    'savings', 'table_banking', 'welfare', 'women_empowerment', 'youth_development',
    'agriculture', 'business_investment', 'housing', 'education', 'health',
    'community_development', 'other',
  ]).optional(),
  meetingFrequency: z.enum(['weekly', 'biweekly', 'monthly']).optional(),
  meetingDay:       z.enum(['monday','tuesday','wednesday','thursday','friday','saturday','sunday']).optional(),
  meetingTime:      z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Time must be HH:MM').optional().or(z.literal('')),

  // Optional KYC details — when present, populate the shared person record.
  nationalId:    z.string().max(32).optional().or(z.literal('')),
  dateOfBirth:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional().or(z.literal('')),
  gender:        z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
});

export const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword:     z.string().min(8)
                    .regex(/[A-Z]/, 'Must contain uppercase')
                    .regex(/[0-9]/, 'Must contain a number'),
});

export const ResetPasswordSchema = z.object({
  phone:    z.string().refine(isValidKenyanPhone, 'Invalid Kenyan phone number'),
  otp:      z.string().length(6),
  password: z.string().min(8),
});

export type LoginInput            = z.infer<typeof LoginSchema>;
export type RegisterInput         = z.infer<typeof RegisterSchema>;
export type RefreshInput          = z.infer<typeof RefreshSchema>;
export type ChangePasswordInput   = z.infer<typeof ChangePasswordSchema>;
export type ResetPasswordInput    = z.infer<typeof ResetPasswordSchema>;
