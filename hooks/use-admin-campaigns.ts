'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminFetch } from '@/hooks/use-admin';
import type { Campaign } from '@/lib/services/campaigns.service';
import type { PlatformQueueRow } from '@/lib/services/campaign-withdrawals.service';

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

const RELEASE_KEY = ['admin', 'campaign-withdrawals'] as const;

export function useAwaitingReleases() {
  return useQuery({
    queryKey: RELEASE_KEY,
    queryFn: () => adminFetch<PlatformQueueRow[]>('/api/admin/campaign-withdrawals'),
  });
}

export function useApproveRelease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      adminFetch<unknown>(`/api/admin/campaign-withdrawals/${id}/approve`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: RELEASE_KEY }),
  });
}

export function useRejectRelease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      adminFetch<unknown>(`/api/admin/campaign-withdrawals/${id}/reject`, { method: 'POST', json: { reason } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: RELEASE_KEY }),
  });
}
