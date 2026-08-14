import { useQuery } from '@tanstack/react-query';
import { smsApi } from '@/lib/api/endpoints';

export const smsAnalyticsKeys = {
  analytics: ['sms', 'analytics'] as const,
};

/** A group's own SMS usage (spec §8). Contains no provider cost — see §15. */
export function useSmsAnalytics() {
  return useQuery({
    queryKey: smsAnalyticsKeys.analytics,
    queryFn:  smsApi.analytics,
    staleTime: 60_000,
  });
}
