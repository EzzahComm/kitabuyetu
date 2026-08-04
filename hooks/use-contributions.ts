import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { contributionsApi } from '@/lib/api/endpoints';
import type { CreateContributionPayload, SetSavingsLimitsPayload } from '@/lib/validators/contribution.schema';

export const contributionKeys = {
  all:    ['contributions'] as const,
  list:   (params?: Record<string, unknown>) => [...contributionKeys.all, 'list', params] as const,
  detail: (id: string) => [...contributionKeys.all, id] as const,
};

export function useContributions(params?: Record<string, unknown>) {
  return useQuery({
    queryKey: contributionKeys.list(params),
    queryFn:  () => contributionsApi.list(params),
  });
}

export function useContribution(id: string) {
  return useQuery({
    queryKey: contributionKeys.detail(id),
    queryFn:  () => contributionsApi.getById(id),
    enabled:  !!id,
  });
}

export function useRecordContribution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateContributionPayload) => contributionsApi.create(body),
    onSuccess:  () => qc.invalidateQueries({ queryKey: contributionKeys.all }),
  });
}

/** Effective group savings limits (advisory min/max/grace period for the contribution form). */
export function useSavingsPolicy() {
  return useQuery({
    queryKey: [...contributionKeys.all, 'policy'],
    queryFn:  () => contributionsApi.policy(),
  });
}

export function useSetSavingsPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SetSavingsLimitsPayload) => contributionsApi.setPolicy(body),
    onSuccess:  () => qc.invalidateQueries({ queryKey: [...contributionKeys.all, 'policy'] }),
  });
}
