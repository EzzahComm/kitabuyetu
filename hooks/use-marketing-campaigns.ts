import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { Audience, Campaign, AudienceSource } from '@/lib/services/marketing-campaigns.service';

const AUDIENCES_BASE = '/marketing/audiences';
const CAMPAIGNS_BASE = '/marketing/campaigns';

const keys = {
  audiences: ['marketing', 'audiences'] as const,
  campaigns: ['marketing', 'campaigns'] as const,
  campaign:  (id: string) => ['marketing', 'campaigns', id] as const,
};

export function useAudiences() {
  return useQuery({
    queryKey: keys.audiences,
    queryFn:  () => api.get<Audience[]>(AUDIENCES_BASE),
  });
}

export function useCreateAudience() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; source: AudienceSource }) => api.post<Audience>(AUDIENCES_BASE, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.audiences }),
  });
}

export function useCampaigns() {
  return useQuery({
    queryKey: keys.campaigns,
    queryFn:  () => api.get<Campaign[]>(CAMPAIGNS_BASE),
    refetchInterval: (query) => {
      const data = query.state.data as Campaign[] | undefined;
      return data?.some((c) => c.status === 'sending') ? 4000 : false;
    },
  });
}

export function useCampaign(id: string) {
  return useQuery({
    queryKey: keys.campaign(id),
    queryFn:  () => api.get<Campaign>(`${CAMPAIGNS_BASE}/${id}`),
    enabled:  !!id,
    refetchInterval: (query) => (query.state.data as Campaign | undefined)?.status === 'sending' ? 4000 : false,
  });
}

export function useCreateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { title: string; message: string; audience_id: string }) =>
      api.post<Campaign>(CAMPAIGNS_BASE, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.campaigns }),
  });
}

export function useSubmitCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<Campaign>(`${CAMPAIGNS_BASE}/${id}/submit`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.campaigns }),
  });
}

export function useApproveCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<Campaign>(`${CAMPAIGNS_BASE}/${id}/approve`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.campaigns }),
  });
}

export function useRejectCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post<Campaign>(`${CAMPAIGNS_BASE}/${id}/reject`, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.campaigns }),
  });
}

export function useCancelCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<Campaign>(`${CAMPAIGNS_BASE}/${id}/cancel`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.campaigns }),
  });
}
