'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { MarketingAnalytics } from '@/lib/services/marketing-analytics.service';

export function useMarketingAnalytics(days = 30) {
  return useQuery({
    queryKey: ['marketing', 'analytics', days],
    queryFn:  () => api.get<MarketingAnalytics>(`/marketing/analytics?days=${days}`),
  });
}
