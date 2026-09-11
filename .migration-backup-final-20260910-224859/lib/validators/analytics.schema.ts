import { z } from 'zod';

export const ANALYTICS_PERIODS = ['30d', '90d', '12mo', 'all'] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];

export const AnalyticsQuerySchema = z.object({
  period: z.enum(ANALYTICS_PERIODS).default('12mo'),
});

export type AnalyticsQueryInput = z.infer<typeof AnalyticsQuerySchema>;

/** Convert a period token to a Postgres interval string and a bucket grain. */
export function periodToInterval(p: AnalyticsPeriod): { interval: string; grain: 'day' | 'month' } {
  switch (p) {
    case '30d':  return { interval: '30 days',   grain: 'day'   };
    case '90d':  return { interval: '90 days',   grain: 'day'   };
    case '12mo': return { interval: '12 months', grain: 'month' };
    case 'all':  return { interval: '100 years', grain: 'month' };
  }
}
