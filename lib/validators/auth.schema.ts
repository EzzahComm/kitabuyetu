import { z } from 'zod';
import { isValidKenyanPhone } from '@/lib/utils/phone';

// Identifier may be either a Kenyan phone number or an email address.
// The login route detects which by the presence of '@'.
//
// groupCode is OPTIONAL: when a member belongs to a single group, the route
// resolves it automatically. When the member is in multiple groups, the route
// responds with `needsGroupSelection` and the client re-submits with the
// chosen groupCode. This avoids leaking group memberships in the schema.
export const LoginSchema = z.object({
  identifier: z.string()
                .min(1, 'Phone number or email is required')
                .refine(
                  (v) => v.includes('@') || isValidKenyanPhone(v),
                  'Enter a valid Kenyan phone number or email address',
                ),
  password:   z.string().min(1, 'Password is required'),
  groupCode:  z.string()
                .regex(/^KY[0-9]{7}$/i, 'Group code looks like KY0000001')
                .optional(),
});

// Shared by RegisterSchema (public, unauthenticated — creates a new person
// AND a new group) and CreateAdditionalGroupSchema (authenticated — reuses
// the caller's existing person/member identity, only creates the group).
// Every field here is group-only; none of it touches members/person.
//
// Every field is required or optional exactly the same way regardless of
// product (checked before extracting this, so this is a fact, not an
// assumption): primaryObjective/meetingFrequency/meetingDay/meetingTime are
// optional for both kitabu_yetu and chama_reminder alike, and
// groupName/groupType/countyId/creatorRole are required for both.
const groupDetailsFields = {
  // Which product this group is signing up for (migration 140). Defaults to
  // kitabu_yetu, so every existing caller is unchanged. A chama_reminder
  // signup skips the chart-of-accounts seeding inside register_group() — it is
  // a communication-only product with no journals to post.
  //
  // Client-supplied and that is fine: it grants nothing. The group still has to
  // pay for whatever it wants to use, and buying Kitabu Yetu later seeds the
  // ledger it skipped.
  product:   z.enum(['kitabu_yetu', 'chama_reminder']).default('kitabu_yetu'),

  // Group identity
  groupName: z.string().min(3, 'Group name must be at least 3 characters').max(255),
  groupType: z.enum(['chama', 'sacco', 'welfare', 'investment', 'organization_group']),

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
} as const;

// Mirrors the public.register_group RPC signature + the v2 workflow spec.
// Phase D MVP — verification (email/SMS) fields will be added in Part 2.
export const RegisterSchema = z.object({
  ...groupDetailsFields,

  // Registrant identity
  firstName: z.string().min(2).max(100),
  lastName:  z.string().min(2).max(100),
  phone:     z.string().refine(isValidKenyanPhone, 'Invalid Kenyan phone number'),
  email:     z.string().email('Invalid email address').optional().nullable().or(z.literal('')),
  password:  z.string().min(8, 'Password must be at least 8 characters')
               .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
               .regex(/[0-9]/, 'Password must contain at least one number'),

  // Optional KYC details — when present, populate the shared person record.
  nationalId:    z.string().max(32).optional().or(z.literal('')),
  dateOfBirth:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional().or(z.literal('')),
  gender:        z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
});

// Mirrors the public.create_additional_group RPC (migration 147). Group-only
// — no person/KYC fields, since an authenticated caller already has an
// identity; the route resolves it server-side from the verified session, the
// same trust model app/api/v1/auth/switch-group/route.ts already uses.
export const CreateAdditionalGroupSchema = z.object(groupDetailsFields);

// Backoffice login (super_admin / support / organization_coordinator).
// Email-only on purpose — staff identities are issued + recovered via email,
// never phone. No group code field because backoffice context isn't
// group-scoped.
// `surface` disambiguates which login page the attempt came from
// (/admin-login vs /enterprise/login) — the route enforces a different
// allowed-role list per surface (see SURFACE_ALLOWED_ROLES). Client-supplied
// and not itself a security boundary: it only narrows which pre-validated
// role can pass, it never grants anything the account's real platform_role
// wouldn't already allow. Optional + defaults to 'platform' so existing
// callers (tests, any stale client) keep working unchanged.
export const AdminLoginSchema = z.object({
  email:    z.string().email('Enter a valid work email'),
  password: z.string().min(1, 'Password is required'),
  surface:  z.enum(['platform', 'organization']).optional().default('platform'),
});

// Step 2 of the backoffice login flow (Phase 2 — MFA). The `challenge`
// token is short-lived (5 min) and identifies the in-flight session;
// `code` is either a 6-digit TOTP or a recovery code (10 hex chars with
// optional dash). `label` is set ONLY during enrollment-confirm and gets
// persisted as the authenticator nickname.
export const AdminLoginMfaVerifySchema = z.object({
  challenge: z.string().min(1, 'MFA challenge token is required'),
  code:      z.string()
               .min(6, 'Enter the 6-digit code from your authenticator')
               .max(20),
  label:     z.string().max(80).optional(),
  // Disambiguates which organization to sign into when the member is
  // active staff at more than one (multi-staff organizations, migration 101).
  organizationId: z.string().uuid().optional(),
});

// Phase D Part 2 — registrant verification.
export const VerifyStartSchema = z.object({
  channel:     z.enum(['email', 'sms']),
  destination: z.string().min(5).max(255),
});

// Only the SMS path goes through /verify/complete — email links are consumed
// by the public GET /verify/email route since the token itself is the proof.
export const VerifyCompleteSchema = z.object({
  channel: z.literal('sms'),
  code:    z.string().length(6).regex(/^\d{6}$/, 'OTP must be 6 digits'),
});

export type VerifyStartInput    = z.infer<typeof VerifyStartSchema>;
export type VerifyCompleteInput = z.infer<typeof VerifyCompleteSchema>;

export const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

/**
 * This schema was written but had **no route and no caller anywhere** until
 * CLIENT_SERVER_CONTRACT_AUDIT_2026-08.md — meanwhile the settings page's
 * change-password form posted to PATCH /members/[id], which ignores password
 * fields, so it always reported success without changing anything.
 * `POST /api/v1/auth/change-password` now uses it.
 */
export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword:     z.string().min(8)
                    .regex(/[A-Z]/, 'Must contain uppercase')
                    .regex(/[0-9]/, 'Must contain a number'),
});

export const ForgotPasswordStartSchema = z.object({
  phone: z.string().refine(isValidKenyanPhone, 'Invalid Kenyan phone number'),
});

export const ResetPasswordSchema = z.object({
  phone:    z.string().refine(isValidKenyanPhone, 'Invalid Kenyan phone number'),
  otp:      z.string().length(6),
  password: z.string().min(8, 'Password must be at least 8 characters')
               .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
               .regex(/[0-9]/, 'Password must contain at least one number'),
});

// Backoffice/staff forgot-password — email-link based (staff identities are
// recovered via email, never phone; see AdminLoginSchema's comment above).
export const AdminForgotPasswordStartSchema = z.object({
  email: z.string().email('Enter a valid work email'),
});

// The token itself is the proof of possession (mirrors VerifyStartSchema's
// email-link shape) — no email/phone re-entered here.
export const AdminResetPasswordSchema = z.object({
  token:    z.string().min(32).max(128),
  password: z.string().min(8, 'Password must be at least 8 characters')
               .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
               .regex(/[0-9]/, 'Password must contain at least one number'),
});

export type LoginInput            = z.infer<typeof LoginSchema>;
export type AdminLoginInput       = z.infer<typeof AdminLoginSchema>;
export type AdminLoginMfaVerifyInput = z.infer<typeof AdminLoginMfaVerifySchema>;
export type RegisterInput         = z.infer<typeof RegisterSchema>;
export type CreateAdditionalGroupInput = z.infer<typeof CreateAdditionalGroupSchema>;
export type RefreshInput          = z.infer<typeof RefreshSchema>;
export type ChangePasswordInput   = z.infer<typeof ChangePasswordSchema>;
export type ForgotPasswordStartInput = z.infer<typeof ForgotPasswordStartSchema>;
export type ResetPasswordInput    = z.infer<typeof ResetPasswordSchema>;
export type AdminForgotPasswordStartInput = z.infer<typeof AdminForgotPasswordStartSchema>;
export type AdminResetPasswordInput = z.infer<typeof AdminResetPasswordSchema>;

// Client request-body types. z.input, not z.infer: a field carrying
// .default() is optional on the wire but present after parsing, so the
// server-side *Input aliases above are the wrong shape for a caller.
export type RegisterPayload = z.input<typeof RegisterSchema>;
export type CreateAdditionalGroupPayload = z.input<typeof CreateAdditionalGroupSchema>;
export type ChangePasswordPayload = z.input<typeof ChangePasswordSchema>;
