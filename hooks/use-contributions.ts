import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { contributionsApi } from '@/lib/api/endpoints';

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
    mutationFn: (body: unknown) => contributionsApi.create(body),
    onSuccess:  () => qc.invalidateQueries({ queryKey: contributionKeys.all }),
  });
}
