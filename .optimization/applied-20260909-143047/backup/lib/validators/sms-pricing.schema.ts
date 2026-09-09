import { z } from 'zod';

/**
 * Super-admin SMS pricing input (spec §12).
 *
 * Bounds are deliberately generous rather than opinionated — the point of
 * making pricing configurable is that the numbers change without a deploy. What
 * these schemas refuse is the shape of a mistake: a negative price, an inverted
 * band, a package that sells zero credits.
 */

export const TierCreateSchema = z.object({
  kind:        z.literal('tier'),
  name:        z.string().min(1).max(60),
  minCredits:  z.number().int().min(0),
  // null means "and above" — the open-ended top band. Explicitly nullable
  // rather than optional, so the intent is stated rather than inferred.
  maxCredits:  z.number().int().min(0).nullable(),
  unitPrice:   z.number().min(0),
  displayOrder: z.number().int().min(0).optional(),
  notes:       z.string().max(500).nullish(),
}).refine((d) => d.maxCredits === null || d.maxCredits >= d.minCredits, {
  message: 'maxCredits must be at least minCredits',
  path:    ['maxCredits'],
});

export const TierUpdateSchema = z.object({
  kind:        z.literal('tier').optional(),
  name:        z.string().min(1).max(60).optional(),
  minCredits:  z.number().int().min(0).optional(),
  maxCredits:  z.number().int().min(0).nullable().optional(),
  unitPrice:   z.number().min(0).optional(),
  displayOrder: z.number().int().min(0).optional(),
  notes:       z.string().max(500).nullish(),
});

/**
 * The COMPLETE set of bands that should be live, not a single toggle.
 *
 * "Which bands are active" is one decision; applying it as a series of
 * independent toggles is what produces overlapping intermediate states. An
 * empty array is legal and means "sell nothing at a custom quantity", which is
 * a real if unusual choice.
 */
export const ActivateTiersSchema = z.object({
  kind:    z.literal('activate_tiers'),
  tierIds: z.array(z.string().uuid()),
});

export const PackageCreateSchema = z.object({
  kind:          z.literal('package'),
  name:          z.string().min(1).max(60),
  description:   z.string().max(500).nullish(),
  credits:       z.number().int().positive(),
  price:         z.number().min(0),
  isRecommended: z.boolean().optional(),
  displayOrder:  z.number().int().min(0).optional(),
});

export const PackageUpdateSchema = z.object({
  kind:          z.literal('package').optional(),
  name:          z.string().min(1).max(60).optional(),
  description:   z.string().max(500).nullish(),
  credits:       z.number().int().positive().optional(),
  price:         z.number().min(0).optional(),
  isRecommended: z.boolean().optional(),
  isActive:      z.boolean().optional(),
  displayOrder:  z.number().int().min(0).optional(),
});

export const ProviderCostSchema = z.object({
  kind:     z.literal('provider_cost'),
  unitCost: z.number().min(0),
  notes:    z.string().max(500).optional(),
});

export type TierCreateInput    = z.infer<typeof TierCreateSchema>;
export type PackageCreateInput = z.infer<typeof PackageCreateSchema>;
