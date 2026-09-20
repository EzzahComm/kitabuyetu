'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminFetch } from '@/hooks/use-admin';
import type { Campaign } from '@/lib/services/campaigns.service';

const KEY = ['admin', 'campaigns'] as const;

export function usePendingCampaigns() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => adminFetch<Campaign[]>('/api/admin/campaigns'),
  });
}

export function useApproveCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminFetch<Campaign>(`/api/admin/campaigns/${id}/approve`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useRejectCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      adminFetch<Campaign>(`/api/admin/campaigns/${id}/reject`, { method: 'POST', json: { reason } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
