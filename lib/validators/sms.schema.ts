import { z } from 'zod';
import { isValidKenyanPhone } from '@/lib/utils/phone';

const phoneSchema = z.string().refine(isValidKenyanPhone, 'Invalid Kenyan phone number');

export const SendSmsSchema = z.object({
  phone:         phoneSchema.or(z.array(phoneSchema)),
  message:       z.string().min(1).max(320),
  referenceType: z.string().max(50).optional().nullable(),
  referenceId:   z.string().uuid().optional().nullable(),
});

export const SmsUsageQuerySchema = z.object({
  page:    z.coerce.number().int().min(1).default(1),
  limit:   z.coerce.number().int().min(1).max(100).default(20),
  status:  z.enum(['queued', 'sent', 'delivered', 'failed', 'rejected']).optional(),
  from:    z.string().date().optional(),
  to:      z.string().date().optional(),
});

export const BulkSmsSchema = z.object({
  phones:        z.array(phoneSchema).min(1).max(5000),
  message:       z.string().min(1).max(320),
  senderId:      z.string().max(20).optional(),
  timeToSend:    z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/).optional(),
  referenceType: z.string().max(50).optional().nullable(),
  referenceId:   z.string().uuid().optional().nullable(),
});

export const CampaignCreateSchema = z.object({
  name:           z.string().min(1).max(100),
  description:    z.string().max(500).optional(),
  message:        z.string().min(1).max(320),
  templateId:     z.string().uuid().optional(),
  recipientType:  z.enum(['all_members', 'active_members', 'selected', 'custom_phones']).default('all_members'),
  rawRecipients:  z.record(z.unknown()).optional(),
  scheduledAt:    z.string().datetime({ offset: true }).optional().nullable(),
  senderId:       z.string().max(20).optional(),
});

export const TemplateCreateSchema = z.object({
  templateKey: z.string().min(1).max(50).regex(/^[a-z0-9_]+$/),
  name:        z.string().min(1).max(100),
  body:        z.string().min(1).max(640),
  category:    z.enum(['transaction', 'loan', 'reminder', 'birthday', 'onboarding', 'auth', 'announcement', 'custom']).default('custom'),
});

export const TemplateUpdateSchema = TemplateCreateSchema.partial().omit({ templateKey: true });

export const ScheduleCreateSchema = z.object({
  name:           z.string().min(1).max(100),
  description:    z.string().max(500).optional(),
  scheduleType:   z.enum(['one_time', 'daily', 'weekly', 'monthly', 'birthday', 'loan_due']),
  templateId:     z.string().uuid().optional(),
  message:        z.string().min(1).max(320).optional(),
  recipientType:  z.enum(['all_members', 'active_members', 'selected', 'custom_phones']).default('all_members'),
  rawRecipients:  z.record(z.unknown()).optional(),
  cronExpression: z.string().max(50).optional(),
  nextRunAt:      z.string().datetime({ offset: true }).optional(),
  timezone:       z.string().max(50).default('Africa/Nairobi'),
  daysBefore:     z.number().int().min(0).max(30).optional(),
  isActive:       z.boolean().default(true),
});

export type SendSmsInput        = z.infer<typeof SendSmsSchema>;
export type SmsUsageQueryInput  = z.infer<typeof SmsUsageQuerySchema>;
export type BulkSmsInput        = z.infer<typeof BulkSmsSchema>;
export type CampaignCreateInput = z.infer<typeof CampaignCreateSchema>;
export type TemplateCreateInput = z.infer<typeof TemplateCreateSchema>;
export type TemplateUpdateInput = z.infer<typeof TemplateUpdateSchema>;
export type ScheduleCreateInput = z.infer<typeof ScheduleCreateSchema>;
