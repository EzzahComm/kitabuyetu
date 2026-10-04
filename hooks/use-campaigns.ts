import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { Campaign, CampaignDonation, CreateCampaignInput } from '@/lib/services/campaigns.service';
import type { CampaignWithdrawalRow } from '@/lib/services/campaign-withdrawals.service';
import type { PayoutDestination } from '@/lib/campaigns/payout-destination';
import type { CampaignEligibility } from '@/lib/services/campaign-plan.service';

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

/** Does the group have an active Changi$ha plan and the chairperson, treasurer and secretary a campaign needs? */
export function useCampaignEligibility() {
  return useQuery({
    queryKey: [...campaignKeys.all, 'eligibility'] as const,
    queryFn: () => api.get<CampaignEligibility>(`${BASE}/eligibility`),
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

export function useSetCampaignPayoutDestination(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (destination: PayoutDestination) => api.patch<Campaign>(`${BASE}/${id}`, destination),
    onSuccess: () => qc.invalidateQueries({ queryKey: campaignKeys.detail(id) }),
  });
}

/** Same "one key per open dialog" idempotency-key pattern as the treasury
 *  page's settlements/vendor-payments tabs — a retried click reuses it, a
 *  fresh click gets a new one. */
const newIdempotencyKey = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function useCampaignWithdrawals(id: string) {
  return useQuery({
    queryKey: [...campaignKeys.detail(id), 'withdrawals'],
    queryFn: () => api.get<CampaignWithdrawalRow[]>(`${BASE}/${id}/withdrawals`),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useRequestCampaignWithdrawal(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (grossAmount: number) =>
      api.post<CampaignWithdrawalRow>(
        `${BASE}/${id}/withdrawals`,
        { grossAmount },
        { headers: { 'Idempotency-Key': newIdempotencyKey() } },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...campaignKeys.detail(id), 'withdrawals'] }),
  });
}

export function useCampaignWithdrawalAction(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      args: { withdrawalId: string; action: 'approve' } | { withdrawalId: string; action: 'reject'; reason: string },
    ) =>
      api.post<CampaignWithdrawalRow>(
        `${BASE}/${id}/withdrawals/${args.withdrawalId}`,
        args.action === 'approve' ? { action: 'approve' } : { action: 'reject', reason: args.reason },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...campaignKeys.detail(id), 'withdrawals'] }),
  });
}
