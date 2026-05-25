import { z } from 'zod';

export const RELIABILITY_TIERS = [
  'excellent', 'good', 'fair', 'poor', 'high_risk',
] as const;

export type ReliabilityTier = (typeof RELIABILITY_TIERS)[number];

export const CreditScoreQuerySchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  tier:  z.enum(RELIABILITY_TIERS).optional(),
  // Filter to members whose latest score is below this threshold (risk view).
  maxScore: z.coerce.number().min(0).max(100).optional(),
});

export const ScoreHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(12),
});

export type CreditScoreQueryInput  = z.infer<typeof CreditScoreQuerySchema>;
export type ScoreHistoryQueryInput = z.infer<typeof ScoreHistoryQuerySchema>;
