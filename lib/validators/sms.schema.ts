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

/**
 * Two mutually exclusive ways to address a bulk send:
 *
 * - `phones` — an explicit list the operator typed in (the "Custom Phones" box).
 * - `recipientType` — a membership query the SERVER resolves, via the same
 *   `resolveSmsRecipients()` campaigns and schedules already use.
 *
 * The second one exists because the browser cannot reliably enumerate a group's
 * membership: it can only page through `/members`, which caps at 100 rows.
 * `ComposeTab` used to try, asking for a non-existent `pageSize: 500` that Zod
 * silently stripped — so "Send to All Members" reached the default 20 and no
 * error was raised anywhere. Sending to "everyone" is a question about the
 * group, and the group's row set lives on the server; asking the client to
 * assemble the answer is what made a wrong answer possible.
 * See docs/audits/PRODUCT_CONCORDANCE_AUDIT_2026-08.md §3.1.
 *
 * `.max(5000)` binds only the client-supplied list. A server-resolved audience
 * is the group's real membership and is not truncated to fit a request cap.
 */
export const BulkSmsSchema = z.object({
  phones:        z.array(phoneSchema).min(1).max(5000).optional(),
  recipientType: z.enum(['all_members', 'active_members']).optional(),
  message:       z.string().min(1).max(320),
  senderId:      z.string().max(20).optional(),
  timeToSend:    z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/).optional(),
  referenceType: z.string().max(50).optional().nullable(),
  referenceId:   z.string().uuid().optional().nullable(),
}).refine(
  (d) => (d.phones !== undefined) !== (d.recipientType !== undefined),
  {
    message: 'Provide exactly one of `phones` or `recipientType`.',
    path: ['phones'],
  },
);

export const CampaignCreateSchema = z.object({
  name:           z.string().min(1).max(100),
  description:    z.string().max(500).optional(),
  message:        z.string().min(1).max(320),
  templateId:     z.string().uuid().optional(),
  recipientType:  z.enum(['all_members', 'active_members', 'selected', 'custom_phones']).default('all_members'),
  rawRecipients:  z.record(z.unknown()).optional(),
  scheduledAt:    z.string().datetime({ offset: true }).optional().nullable(),
  senderId:       z.string().max(20).optional(),
  // Who pays. Defaults to the group, preserving prior behaviour. An
  // organization-funded campaign debits organization_billing_accounts instead.
  fundedBy:       z.enum(['group', 'organization']).default('group'),
  organizationId: z.string().uuid().optional(),
}).refine(
  (v) => v.fundedBy === 'group' || !!v.organizationId,
  { message: 'organizationId is required when fundedBy is "organization"', path: ['organizationId'] },
);

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
  // 'birthday'/'loan_due' are deliberately excluded here even though the DB
  // CHECK constraint (migration 013) still permits them historically — both
  // are handled as dedicated global jobs (sms_birthday_reminders,
  // notify_loan_due_alerts) with day-varying, rule-based recipients, not a
  // fixed-audience row on a fixed cadence. sms-scheduler.service.ts's own
  // processDueSmsSchedules() has never processed these two values (see its
  // header comment) — a row created with either would previously sit inert
  // forever. Blocking creation here, not widening the scheduler to handle
  // them, since the recipient-selection model these two need doesn't fit
  // this table's shape.
  scheduleType:   z.enum(['one_time', 'daily', 'weekly', 'monthly']),
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

/**
 * Per-group messaging automation toggles. Every field optional so a page can
 * flip one without having to send (and risk clearing) the rest — the route
 * COALESCEs each against its stored value.
 */
export const SmsGroupSettingsUpdateSchema = z.object({
  autoSendContribution: z.boolean().optional(),
  autoSendLoan:         z.boolean().optional(),
  autoSendMeeting:      z.boolean().optional(),
  autoSendBirthday:     z.boolean().optional(),
});

export type SendSmsInput        = z.infer<typeof SendSmsSchema>;
export type SmsGroupSettingsUpdateInput = z.infer<typeof SmsGroupSettingsUpdateSchema>;
export type SmsUsageQueryInput  = z.infer<typeof SmsUsageQuerySchema>;
export type BulkSmsInput        = z.infer<typeof BulkSmsSchema>;
export type CampaignCreateInput = z.infer<typeof CampaignCreateSchema>;
export type TemplateCreateInput = z.infer<typeof TemplateCreateSchema>;
export type TemplateUpdateInput = z.infer<typeof TemplateUpdateSchema>;
export type ScheduleCreateInput = z.infer<typeof ScheduleCreateSchema>;

// Client request-body types. z.input, not z.infer: a field carrying
// .default() is optional on the wire but present after parsing, so the
// server-side *Input aliases above are the wrong shape for a caller.
export type SendSmsPayload = z.input<typeof SendSmsSchema>;
export type BulkSmsPayload = z.input<typeof BulkSmsSchema>;
export type CampaignCreatePayload = z.input<typeof CampaignCreateSchema>;
export type TemplateCreatePayload = z.input<typeof TemplateCreateSchema>;
export type TemplateUpdatePayload = z.input<typeof TemplateUpdateSchema>;
export type ScheduleCreatePayload = z.input<typeof ScheduleCreateSchema>;
