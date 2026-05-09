import { z } from 'zod';
import { isValidKenyanPhone } from '@/lib/utils/phone';

export const CreateMemberSchema = z.object({
  phone:     z.string().refine(isValidKenyanPhone, 'Invalid Kenyan phone number'),
  firstName: z.string().min(2).max(100),
  lastName:  z.string().min(2).max(100),
  email:     z.string().email().optional().nullable(),
  nationalId: z.string().max(20).optional().nullable(),
  dateOfBirth: z.string().date().optional().nullable(),
  gender:    z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional().nullable(),
  address:   z.string().max(500).optional().nullable(),
  role:      z.enum(['group_admin', 'treasurer', 'secretary', 'member']).default('member'),
});

export const UpdateMemberSchema = z.object({
  firstName:   z.string().min(2).max(100).optional(),
  lastName:    z.string().min(2).max(100).optional(),
  email:       z.string().email().optional().nullable(),
  nationalId:  z.string().max(20).optional().nullable(),
  dateOfBirth: z.string().date().optional().nullable(),
  gender:      z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional().nullable(),
  address:     z.string().max(500).optional().nullable(),
  profilePhotoUrl: z.string().url().optional().nullable(),
});

export const UpdateMemberRoleSchema = z.object({
  role: z.enum(['group_admin', 'treasurer', 'secretary', 'member']),
});

export const MemberQuerySchema = z.object({
  page:    z.coerce.number().int().min(1).default(1),
  limit:   z.coerce.number().int().min(1).max(100).default(20),
  search:  z.string().optional(),
  role:    z.enum(['group_admin', 'treasurer', 'secretary', 'member']).optional(),
  active:  z.coerce.boolean().optional(),
  sortBy:  z.enum(['first_name', 'last_name', 'joined_at', 'created_at']).default('first_name'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
});

export type CreateMemberInput     = z.infer<typeof CreateMemberSchema>;
export type UpdateMemberInput     = z.infer<typeof UpdateMemberSchema>;
export type UpdateMemberRoleInput = z.infer<typeof UpdateMemberRoleSchema>;
export type MemberQueryInput      = z.infer<typeof MemberQuerySchema>;
