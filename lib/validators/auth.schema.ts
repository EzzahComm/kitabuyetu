import { z } from 'zod';
import { isValidKenyanPhone } from '@/lib/utils/phone';

export const LoginSchema = z.object({
  phone:   z.string().refine(isValidKenyanPhone, 'Invalid Kenyan phone number'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  groupId: z.string().uuid('Invalid group ID'),
});

export const RegisterSchema = z.object({
  phone:     z.string().refine(isValidKenyanPhone, 'Invalid Kenyan phone number'),
  password:  z.string().min(8, 'Password must be at least 8 characters')
               .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
               .regex(/[0-9]/, 'Password must contain at least one number'),
  firstName: z.string().min(2).max(100),
  lastName:  z.string().min(2).max(100),
  groupId:   z.string().uuid('Invalid group ID'),
  email:     z.string().email().optional().nullable(),
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
