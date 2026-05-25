import { z } from 'zod';

// ── Share classes ──────────────────────────────────────────────────────────

const classCommon = {
  name:             z.string().min(2).max(80),
  code:             z.string().min(1).max(20).regex(/^[A-Z0-9_-]+$/i, 'Code must be alphanumeric (and -_ allowed)'),
  description:      z.string().max(1000).optional().nullable(),
  parValue:         z.coerce.number().positive('Par value must be greater than zero'),
  currentValue:     z.coerce.number().nonnegative().optional().nullable(),
  minPerMember:     z.coerce.number().int().nonnegative().optional().nullable(),
  maxPerMember:     z.coerce.number().int().positive().optional().nullable(),
  votingWeight:     z.coerce.number().nonnegative().default(1),
  transferAllowed:  z.coerce.boolean().default(true),
  lockPeriodDays:   z.coerce.number().int().nonnegative().default(0),
  isActive:         z.coerce.boolean().default(true),
};

export const CreateShareClassSchema = z.object(classCommon).refine(
  (v) => v.minPerMember == null || v.maxPerMember == null || v.minPerMember <= v.maxPerMember,
  { path: ['maxPerMember'], message: 'maxPerMember must be greater than or equal to minPerMember' },
);

export const UpdateShareClassSchema = z.object({
  name:             classCommon.name.optional(),
  code:             classCommon.code.optional(),
  description:      classCommon.description,
  parValue:         classCommon.parValue.optional(),
  currentValue:     classCommon.currentValue,
  minPerMember:     classCommon.minPerMember,
  maxPerMember:     classCommon.maxPerMember,
  votingWeight:     classCommon.votingWeight.optional(),
  transferAllowed:  classCommon.transferAllowed.optional(),
  lockPeriodDays:   classCommon.lockPeriodDays.optional(),
  isActive:         classCommon.isActive.optional(),
});

// ── Share transactions ─────────────────────────────────────────────────────

export const SHARE_TXN_TYPES = [
  'allocation', 'purchase', 'transfer', 'redemption', 'adjustment',
] as const;
export type ShareTxnTypeInput = (typeof SHARE_TXN_TYPES)[number];

export const PAYMENT_METHODS = [
  'mpesa', 'cash', 'bank_transfer', 'cheque', 'other',
] as const;

/**
 * Single create-transaction shape that covers all txn flavours. The service
 * splits 'transfer' into the paired transfer_in / transfer_out rows.
 *
 *   - allocation: { memberId, classId, quantity > 0 } (free shares; unitPrice defaults to 0)
 *   - purchase:   { memberId, classId, quantity > 0, totalAmount, paymentMethod, paymentReference? }
 *   - transfer:   { memberId (from), counterpartyMemberId (to), classId, quantity > 0 }
 *   - redemption: { memberId, classId, quantity > 0, totalAmount, paymentMethod }
 *                 (quantity given as positive; service flips sign for the DB row)
 *   - adjustment: { memberId, classId, quantity (any non-zero), reason }
 */
export const CreateShareTransactionSchema = z.object({
  type:                   z.enum(SHARE_TXN_TYPES),
  memberId:               z.string().uuid('memberId must be a UUID'),
  shareClassId:           z.string().uuid('shareClassId must be a UUID'),
  quantity:               z.coerce.number().int().refine((n) => n !== 0, 'quantity must be non-zero'),
  unitPrice:              z.coerce.number().nonnegative().optional(),
  totalAmount:            z.coerce.number().nonnegative().optional(),

  counterpartyMemberId:   z.string().uuid().optional().nullable(),

  paymentMethod:          z.enum(PAYMENT_METHODS).optional().nullable(),
  paymentReference:       z.string().max(80).optional().nullable(),

  notes:                  z.string().max(1000).optional().nullable(),
  postedAt:               z.string().datetime().optional(),
})
  .refine(
    (v) => v.type !== 'transfer' || !!v.counterpartyMemberId,
    { path: ['counterpartyMemberId'], message: 'counterpartyMemberId is required for transfers' },
  )
  .refine(
    (v) => v.type === 'transfer' || v.memberId !== v.counterpartyMemberId,
    { path: ['counterpartyMemberId'], message: 'counterpartyMemberId must be different from memberId' },
  )
  .refine(
    // Non-adjustment types require positive quantity from the API; the
    // service decides the DB sign per type.
    (v) => v.type === 'adjustment' || v.quantity > 0,
    { path: ['quantity'], message: 'quantity must be positive (sign is set automatically for the chosen type)' },
  );

export const ShareTxnQuerySchema = z.object({
  page:         z.coerce.number().int().min(1).default(1),
  limit:        z.coerce.number().int().min(1).max(200).default(50),
  type:         z.enum(SHARE_TXN_TYPES).optional(),
  memberId:     z.string().uuid().optional(),
  shareClassId: z.string().uuid().optional(),
  from:         z.string().date().optional(),
  to:           z.string().date().optional(),
});

export const ReverseTransactionSchema = z.object({
  reason: z.string().min(3).max(500),
});

export const HoldingsQuerySchema = z.object({
  page:         z.coerce.number().int().min(1).default(1),
  limit:        z.coerce.number().int().min(1).max(200).default(50),
  memberId:     z.string().uuid().optional(),
  shareClassId: z.string().uuid().optional(),
  // Hide rows where the member has zero shares (after redemptions). Default
  // true so callers see only current holders.
  includeZero:  z.coerce.boolean().default(false),
});

export type CreateShareClassInput        = z.infer<typeof CreateShareClassSchema>;
export type UpdateShareClassInput        = z.infer<typeof UpdateShareClassSchema>;
export type CreateShareTransactionInput  = z.infer<typeof CreateShareTransactionSchema>;
export type ShareTxnQueryInput           = z.infer<typeof ShareTxnQuerySchema>;
export type HoldingsQueryInput           = z.infer<typeof HoldingsQuerySchema>;
export type ReverseTransactionInput      = z.infer<typeof ReverseTransactionSchema>;
