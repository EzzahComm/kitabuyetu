import { z } from 'zod';

/**
 * Fines issuance and tracking (Phase 3, migration 180). Style mirrors
 * loan.schema.ts: standalone validator file, PATCH-action union reconstructing
 * the real wire shape, z.input payload aliases for client-facing types.
 */

export const FINE_STATUSES = ['issued', 'paid', 'waived', 'cancelled'] as const;
export type FineStatus = (typeof FINE_STATUSES)[number];

export const IssueFineSchema = z.object({
  memberId: z.string().uuid(),
  /** Offence key — matches a key in fine-policy.service.ts's effective
   *  schedule when no explicit amount is supplied. Free text: the schedule's
   *  own keys are group-defined. */
  fineType: z.string().min(1).max(100),
  /** Overrides the tariff schedule's suggested amount for this offence.
   *  Omit to use the schedule's amount for `fineType`. */
  amount:   z.coerce.number().positive().optional(),
  /** Required when overriding the amount; optional context otherwise. */
  reason:   z.string().max(500).optional(),
}).superRefine((v, ctx) => {
  if (v.amount !== undefined && !v.reason) {
    ctx.addIssue({
      code: 'custom', path: ['reason'],
      message: 'A reason is required when overriding the suggested fine amount',
    });
  }
});

export const WaiveFineSchema = z.object({
  reason: z.string().min(5).max(500),
});

export const CancelFineSchema = z.object({
  reason: z.string().min(5).max(500),
});

export const FineQuerySchema = z.object({
  page:     z.coerce.number().int().min(1).default(1),
  limit:    z.coerce.number().int().min(1).max(100).default(20),
  memberId: z.string().uuid().optional(),
  status:   z.enum(FINE_STATUSES).optional(),
});

export type IssueFineInput  = z.infer<typeof IssueFineSchema>;
export type WaiveFineInput  = z.infer<typeof WaiveFineSchema>;
export type CancelFineInput = z.infer<typeof CancelFineSchema>;
export type FineQueryInput  = z.infer<typeof FineQuerySchema>;

/**
 * PATCH /api/v1/fines/[id] dispatches on `body.action` (loans/[id] pattern) —
 * this union reconstructs the real wire shape so a call site cannot send
 * `action: 'waive'` without the `reason` that action requires.
 */
export type FineActionInput =
  | ({ action: 'waive'  } & WaiveFinePayload)
  | ({ action: 'cancel' } & CancelFinePayload)
  | { action: 'initiateCollection' }
  | { action: 'markPaid' };

// Client request-body types. z.input, not z.infer: IssueFineSchema's fields
// are all optional/required as written on the wire, but kept as aliases here
// for consistency with the rest of the codebase's *Payload convention.
export type IssueFinePayload  = z.input<typeof IssueFineSchema>;
export type WaiveFinePayload  = z.input<typeof WaiveFineSchema>;
export type CancelFinePayload = z.input<typeof CancelFineSchema>;
