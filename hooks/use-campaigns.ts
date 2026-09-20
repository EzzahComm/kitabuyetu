import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { Campaign, CampaignDonation, CreateCampaignInput } from '@/lib/services/campaigns.service';

const BASE = '/campaigns';

export const campaignKeys = {
  all: ['campaigns'] as const,
  lists: () => [...campaignKeys.all, 'list'] as const,
  detail: (id: string) => [...campaignKeys.all, id] as const,
};

export function useCampaigns() {
  return useQuery({
    queryKey: campaignKeys.lists(),
    queryFn: () => api.get<Campaign[]>(BASE),
  });
}

export function useCampaign(id: string) {
  return useQuery({
    queryKey: campaignKeys.detail(id),
    queryFn: () => api.get<Campaign>(`${BASE}/${id}`),
    enabled: !!id,
  });
}

export function useCreateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCampaignInput) => api.post<Campaign>(BASE, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: campaignKeys.lists() }),
  });
}

export function useCampaignDonations(id: string) {
  return useQuery({
    queryKey: [...campaignKeys.detail(id), 'donations'],
    queryFn: () => api.get<CampaignDonation[]>(`${BASE}/${id}/donations`),
    enabled: !!id,
  });
}

export function useSubmitCampaignForReview(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<Campaign>(`${BASE}/${id}/submit`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: campaignKeys.lists() });
      qc.invalidateQueries({ queryKey: campaignKeys.detail(id) });
    },
  });
}
