import { z } from 'zod/v3';

export const SetWeeklyContributionDefaultSchema = z.object({
  weeklyContribution: z.number().min(0).max(1_000_000),
});

export type SetWeeklyContributionDefaultInput = z.infer<typeof SetWeeklyContributionDefaultSchema>;
