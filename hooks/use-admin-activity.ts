'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminFetch } from '@/hooks/use-admin';
import type { ActivityFilters, ActivityListRow } from '@/lib/notifications/activity-query';

export interface ActivityList {
  items: ActivityListRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function useAdminActivity(filters: ActivityFilters) {
  const p = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== '' && v !== false) p.set(k, String(v));
  });
  return useQuery({
    queryKey: ['admin', 'activity', filters],
    queryFn: () => adminFetch<ActivityList>(`/api/admin/activity?${p}`),
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
}

export function useRetryDelivery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminFetch<unknown>(`/api/admin/activity/deliveries/${id}/retry`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'activity'] }),
  });
}
