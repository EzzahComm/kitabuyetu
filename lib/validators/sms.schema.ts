import { z } from 'zod';
import { isValidKenyanPhone } from '@/lib/utils/phone';

const phoneSchema = z.string().refine(isValidKenyanPhone, 'Invalid Kenyan phone number');

/**
 * Ceiling on the ad-hoc `/sms/send` surface.
 *
 * lib/sms/rate-limit.ts holds this route to 30 requests/60s while `/sms/bulk`
 * gets 5/60s, and its comment justifies the gap by calling this "the
 * single/few-recipient path". That was only ever true by convention: the array
 * branch had no `.max()`, so one token could send 30 unbounded fan-outs a
 * minute — past both the bulk request ceiling and the 5,000-recipient cap that
 * ceiling is calibrated against. The limiter counts requests, not recipients,
 * so surface-tiering only holds if per-request volume is actually bounded.
 *
 * Anything larger belongs on /sms/bulk, which is rate-limited and batched for
 * it. 10 is deliberately generous for "a few" while leaving the two surfaces
 * an order of magnitude apart.
 */
const SEND_MAX_RECIPIENTS = 10;

export const SendSmsSchema = z.object({
  phone:         phoneSchema.or(z.array(phoneSchema).min(1).max(SEND_MAX_RECIPIENTS)),
  message:       z.string().min(1).max(320),
  referenceType: z.string().max(50).optional().nullable(),
  referenceId:   z.string().uuid().optional().nullable(),
});

/**
 * Reminder/automation history (SMS-AUDIT-v3 G21).
 *
 * `status` accepts 'suppressed' like any other value — a suppressed row is
 * the record that someone opted out and was honoured, which is exactly what a
 * data-subject request needs to see. Omitting the filter returns every
 * outcome, including suppressed.
 */
export const ReminderHistoryQuerySchema = z.object({
  page:     z.coerce.number().int().min(1).default(1),
  limit:    z.coerce.number().int().min(1).max(100).default(20),
  memberId: z.string().uuid().optional(),
  status:   z.enum(['pending', 'sent', 'failed', 'suppressed']).optional(),
  from:     z.string().date().optional(),
  to:       z.string().date().optional(),
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

/**
 * The audience payload for the two `recipientType` values that carry one.
 *
 * Was `z.record(z.unknown())` on both the campaign and schedule surfaces —
 * i.e. no format check and no cap, on paths that go straight to
 * resolveSmsRecipients() and then to a billed send. Two concrete consequences:
 * `normalizePhone` THROWS on a malformed entry, so one bad number produced a
 * 500 (and, on the campaign path, an orphan sms_campaigns row already
 * inserted); and an unbounded list could be persisted to
 * sms_schedules.raw_recipients to be re-sent on every future occurrence.
 *
 * `.strict()` because a silently-ignored key is how "Send to All Members"
 * once resolved to 20 people — an unrecognised field should be a 400, not a
 * shrug. The cap mirrors BulkSmsSchema.phones so the three client-supplied
 * audience surfaces agree.
 *
 * Deliberately NOT covering resolveSmsRecipients' `roles` branch: that is
 * reached only by trigger rules calling the resolver directly, never over
 * HTTP, and `roles` is absent from both recipientType enums.
 *
 * Applied on WRITE only. Rows already stored in sms_schedules.raw_recipients
 * predate any schema and are read back by the scheduler without
 * re-validation, so tightening here cannot break an existing schedule.
 */
const RawRecipientsSchema = z.object({
  phones:    z.array(phoneSchema).min(1).max(5000).optional(),
  memberIds: z.array(z.string().uuid()).min(1).max(5000).optional(),
}).strict();

/**
 * `recipientType` and `rawRecipients` are two halves of one statement, so
 * validate them together: 'custom_phones' without phones (or 'selected'
 * without memberIds) resolved to an empty audience and sent to nobody, with
 * no error anywhere.
 */
function refineAudience<T extends { recipientType: string; rawRecipients?: { phones?: unknown[]; memberIds?: unknown[] } }>(
  v: T,
  ctx: z.RefinementCtx,
): void {
  if (v.recipientType === 'custom_phones' && !v.rawRecipients?.phones?.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rawRecipients', 'phones'],
      message: 'recipientType "custom_phones" requires rawRecipients.phones',
    });
  }
  if (v.recipientType === 'selected' && !v.rawRecipients?.memberIds?.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rawRecipients', 'memberIds'],
      message: 'recipientType "selected" requires rawRecipients.memberIds',
    });
  }
}

export const CampaignCreateSchema = z.object({
  name:           z.string().min(1).max(100),
  description:    z.string().max(500).optional(),
  message:        z.string().min(1).max(320),
  templateId:     z.string().uuid().optional(),
  recipientType:  z.enum(['all_members', 'active_members', 'selected', 'custom_phones']).default('all_members'),
  rawRecipients:  RawRecipientsSchema.optional(),
  scheduledAt:    z.string().datetime({ offset: true }).optional().nullable(),
  senderId:       z.string().max(20).optional(),
  // Who pays. Defaults to the group, preserving prior behaviour. An
  // organization-funded campaign debits organization_billing_accounts instead.
  fundedBy:       z.enum(['group', 'organization']).default('group'),
  organizationId: z.string().uuid().optional(),
}).superRefine(refineAudience).refine(
  (v) => v.fundedBy === 'group' || !!v.organizationId,
  { message: 'organizationId is required when fundedBy is "organization"', path: ['organizationId'] },
);

export const TemplateCreateSchema = z.object({
  templateKey: z.string().min(1).max(50).regex(/^[a-z0-9_]+$/),
  name:        z.string().min(1).max(100),
  body:        z.string().min(1).max(640),
  category:    z.enum(['transaction', 'loan', 'reminder', 'birthday', 'onboarding', 'auth', 'announcement', 'custom']).default('custom'),
});

/**
 * Pre-send cost preview (SMS-AUDIT-v3 G28).
 *
 * Mirrors the audience half of BulkSmsSchema so a preview is quoted for the
 * exact payload that would be sent — a preview that accepts a different shape
 * than the send would eventually quote for a different audience. Read-only,
 * so unlike BulkSmsSchema it does not carry senderId/timeToSend/reference*.
 *
 * `roles` is excluded for the same reason RawRecipientsSchema omits it: that
 * branch is reached only by trigger rules calling the resolver directly, and
 * a strict rawRecipients has nowhere to put a roles list anyway.
 */
export const BulkPreviewSchema = z.object({
  message:       z.string().min(1).max(320),
  phones:        z.array(phoneSchema).min(1).max(5000).optional(),
  recipientType: z.enum(['all_members', 'active_members', 'custom_phones', 'selected']).optional(),
  rawRecipients: RawRecipientsSchema.optional(),
}).refine(
  (d) => (d.phones !== undefined) !== (d.recipientType !== undefined),
  { message: 'Provide exactly one of `phones` or `recipientType`.', path: ['phones'] },
);

export const TemplateUpdateSchema = TemplateCreateSchema.partial().omit({ templateKey: true });

/**
 * Base object kept separate from the refined create schema below: superRefine
 * yields a ZodEffects, which has no `.partial()`, and the PATCH handler needs
 * a partial. The audience correlation is a CREATE-time rule anyway — a PATCH
 * that touches only `name` must not be forced to resend the audience.
 */
const ScheduleCreateBase = z.object({
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
  rawRecipients:  RawRecipientsSchema.optional(),
  cronExpression: z.string().max(50).optional(),
  nextRunAt:      z.string().datetime({ offset: true }).optional(),
  timezone:       z.string().max(50).default('Africa/Nairobi'),
  daysBefore:     z.number().int().min(0).max(30).optional(),
  isActive:       z.boolean().default(true),
});

export const ScheduleCreateSchema = ScheduleCreateBase.superRefine(refineAudience);

/**
 * PATCH shape. Field-level validation (phone format, uuid, caps) still
 * applies; only the create-time "this recipientType requires that audience"
 * correlation is relaxed.
 */
export const ScheduleUpdateSchema = ScheduleCreateBase.partial();

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
  // NOT nullable: sms_group_settings.daily_send_limit is `INTEGER NOT NULL
  // DEFAULT 500` (migration 013), so "no cap" has no storable representation.
  // A group with no settings row at all is uncapped — which is what
  // GET /sms/settings already reports for them — and once a row exists the
  // cap can be raised but not removed. Bounded well above any plausible
  // legitimate daily volume so a typo cannot silently defeat the control.
  dailySendLimit:       z.number().int().min(1).max(100_000).optional(),
});

export type SendSmsInput        = z.infer<typeof SendSmsSchema>;
export type SmsGroupSettingsUpdateInput = z.infer<typeof SmsGroupSettingsUpdateSchema>;
export type SmsUsageQueryInput  = z.infer<typeof SmsUsageQuerySchema>;
export type ReminderHistoryQueryInput = z.infer<typeof ReminderHistoryQuerySchema>;
export type BulkPreviewInput          = z.infer<typeof BulkPreviewSchema>;
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
