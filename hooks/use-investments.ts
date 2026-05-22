import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { buildQuery } from '@/lib/utils';

const BASE = '/investments';

export const investmentKeys = {
  all:     ['investments'] as const,
  list:    (p?: Record<string, unknown>) => [...investmentKeys.all, 'list', p] as const,
  detail:  (id: string) => [...investmentKeys.all, id] as const,
  summary: ['investments', 'summary'] as const,
};

export function useInvestments(params?: Record<string, unknown>) {
  return useQuery({
    queryKey: investmentKeys.list(params),
    queryFn:  () => api.get<any>(`${BASE}${buildQuery(params ?? {})}`),
  });
}

export function useInvestmentSummary() {
  return useQuery({
    queryKey: investmentKeys.summary,
    queryFn:  () => api.get<any>(`${BASE}?summary=1`),
  });
}

export function useInvestment(id: string) {
  return useQuery({
    queryKey: investmentKeys.detail(id),
    queryFn:  () => api.get<any>(`${BASE}/${id}`),
    enabled:  !!id,
  });
}

export function useCreateInvestment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api.post<any>(BASE, body),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: investmentKeys.all });
      qc.invalidateQueries({ queryKey: investmentKeys.summary });
    },
  });
}

export function useUpdateInvestment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api.patch<any>(`${BASE}/${id}`, body),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: investmentKeys.list() });
      qc.invalidateQueries({ queryKey: investmentKeys.detail(id) });
      qc.invalidateQueries({ queryKey: investmentKeys.summary });
    },
  });
}

export function useRecordInvestmentReturn(investmentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api.post<any>(`${BASE}/${investmentId}/returns`, body),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: investmentKeys.detail(investmentId) });
      qc.invalidateQueries({ queryKey: investmentKeys.summary });
    },
  });
}
