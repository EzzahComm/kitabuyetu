import { z } from 'zod';
import { isValidKenyanPhone } from '@/lib/utils/phone';

// Common field reused by Create + Update
const memberFields = {
  middleName:       z.string().min(1).max(100).optional().nullable(),
  alternativePhone: z.string().refine(
    (v) => v === '' || v === undefined || v === null || isValidKenyanPhone(v),
    'Alternative phone must be a valid Kenyan number',
  ).optional().nullable(),
  countyId:         z.string().uuid('Invalid county id').optional().nullable(),
  occupation:       z.string().max(150).optional().nullable(),
  referredBy:       z.string().uuid('Invalid referrer id').optional().nullable(),
};

export const CreateMemberSchema = z.object({
  phone:            z.string().refine(isValidKenyanPhone, 'Invalid Kenyan phone number'),
  firstName:        z.string().min(2).max(100),
  lastName:         z.string().min(2).max(100),
  email:            z.string().email().optional().nullable(),
  nationalId:       z.string().max(20).optional().nullable(),
  dateOfBirth:      z.string().date().optional().nullable(),
  gender:           z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional().nullable(),
  address:          z.string().max(500).optional().nullable(),
  role:             z.enum(['chairperson', 'treasurer', 'secretary', 'member']).default('member'),
  // Phase E1 additions
  ...memberFields,
});

export const UpdateMemberSchema = z.object({
  firstName:        z.string().min(2).max(100).optional(),
  lastName:         z.string().min(2).max(100).optional(),
  email:            z.string().email().optional().nullable(),
  nationalId:       z.string().max(20).optional().nullable(),
  dateOfBirth:      z.string().date().optional().nullable(),
  gender:           z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional().nullable(),
  address:          z.string().max(500).optional().nullable(),
  profilePhotoUrl:  z.string().url().optional().nullable(),
  // Phase E1 additions
  ...memberFields,
});

export const UpdateMemberRoleSchema = z.object({
  role: z.enum(['chairperson', 'treasurer', 'secretary', 'member']),
});

// All UI-facing member statuses. Mirrors the public.member_status enum
// (Phase A + E1). 'pending_verification' is set by registration / invitation;
// listing UIs typically hide 'archived' rows by default.
export const MEMBER_STATUSES = [
  'pending_verification',
  'active',
  'inactive',
  'suspended',
  'rejected',
  'blacklisted',
  'exited',
  'archived',
] as const;

export const MemberQuerySchema = z.object({
  page:           z.coerce.number().int().min(1).default(1),
  limit:          z.coerce.number().int().min(1).max(100).default(20),
  search:         z.string().optional(),
  role:           z.enum(['chairperson', 'treasurer', 'secretary', 'member']).optional(),
  status:         z.enum(MEMBER_STATUSES).optional(),
  includeArchived: z.coerce.boolean().default(false),
  countyId:       z.string().uuid().optional(),
  sortBy:         z.enum(['first_name', 'last_name', 'joined_at', 'created_at']).default('first_name'),
  sortDir:        z.enum(['asc', 'desc']).default('asc'),
});

// Status-transition body. `reason` becomes mandatory for terminal/punitive
// transitions; the service rejects empty reasons for blacklist/suspend/reject.
export const MemberStatusTransitionSchema = z.object({
  status:  z.enum(MEMBER_STATUSES),
  reason:  z.string().max(500).optional(),
});

// Bulk action across multiple members at once (e.g. archive 10 inactive rows).
export const BulkMemberActionSchema = z.object({
  memberIds: z.array(z.string().uuid()).min(1).max(200),
  action:    z.enum(['archive', 'restore', 'suspend', 'blacklist', 'exit']),
  reason:    z.string().max(500).optional(),
});

// ── Next of Kin ────────────────────────────────────────────────────────────

const RELATIONSHIPS = [
  'spouse', 'parent', 'child', 'sibling', 'guardian',
  'grandparent', 'grandchild', 'in_law', 'friend', 'other',
] as const;

export const CreateNextOfKinSchema = z.object({
  fullName:         z.string().min(2).max(200),
  relationship:     z.enum(RELATIONSHIPS),
  phone:            z.string().refine(isValidKenyanPhone, 'Invalid Kenyan phone number'),
  alternativePhone: z.string().refine(
    (v) => v === '' || v === undefined || isValidKenyanPhone(v),
    'Alternative phone must be a valid Kenyan number',
  ).optional().nullable(),
  email:            z.string().email().optional().nullable().or(z.literal('')),
  address:          z.string().max(500).optional().nullable(),
  nationalId:       z.string().max(32).optional().nullable(),
  priority:         z.coerce.number().int().min(1).default(2), // primary (1) is enforced unique at DB level
  notes:            z.string().max(500).optional().nullable(),
});

export const UpdateNextOfKinSchema = CreateNextOfKinSchema.partial();

export type CreateMemberInput          = z.infer<typeof CreateMemberSchema>;
export type UpdateMemberInput          = z.infer<typeof UpdateMemberSchema>;
export type UpdateMemberRoleInput      = z.infer<typeof UpdateMemberRoleSchema>;
export type MemberQueryInput           = z.infer<typeof MemberQuerySchema>;
export type MemberStatusTransitionInput = z.infer<typeof MemberStatusTransitionSchema>;
export type BulkMemberActionInput      = z.infer<typeof BulkMemberActionSchema>;
export type CreateNextOfKinInput       = z.infer<typeof CreateNextOfKinSchema>;
export type UpdateNextOfKinInput       = z.infer<typeof UpdateNextOfKinSchema>;
export type MemberStatus               = (typeof MEMBER_STATUSES)[number];

// Client request-body types. z.input, not z.infer: a field carrying
// .default() is optional on the wire but present after parsing, so the
// server-side *Input aliases above are the wrong shape for a caller.
export type CreateMemberPayload = z.input<typeof CreateMemberSchema>;
export type UpdateMemberPayload = z.input<typeof UpdateMemberSchema>;
export type CreateNextOfKinPayload = z.input<typeof CreateNextOfKinSchema>;
export type UpdateNextOfKinPayload = z.input<typeof UpdateNextOfKinSchema>;
