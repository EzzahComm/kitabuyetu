import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { buildQuery } from '@/lib/utils';

const BASE = '/welfare';

export const welfareKeys = {
  all:    ['welfare'] as const,
  list:   (p?: Record<string, unknown>) => [...welfareKeys.all, 'list', p] as const,
  detail: (id: string) => [...welfareKeys.all, id] as const,
  pool:   ['welfare', 'pool'] as const,
};

export function useWelfareRequests(params?: Record<string, unknown>) {
  return useQuery({
    queryKey: welfareKeys.list(params),
    queryFn:  () => api.get<any>(`${BASE}${buildQuery(params ?? {})}`),
  });
}

export function useWelfareRequest(id: string) {
  return useQuery({
    queryKey: welfareKeys.detail(id),
    queryFn:  () => api.get<any>(`${BASE}/${id}`),
    enabled:  !!id,
  });
}

export function useCreateWelfareRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api.post<any>(BASE, body),
    onSuccess:  () => qc.invalidateQueries({ queryKey: welfareKeys.all }),
  });
}

export function useReviewWelfareRequest(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api.patch<any>(`${BASE}/${id}`, body),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: welfareKeys.list() });
      qc.invalidateQueries({ queryKey: welfareKeys.detail(id) });
    },
  });
}

export function useWelfarePool() {
  return useQuery({
    queryKey: welfareKeys.pool,
    queryFn:  () => api.get<any>(`${BASE}/pool`),
  });
}

export function useRecordWelfarePoolContribution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api.post<any>(`${BASE}/pool`, body),
    onSuccess:  () => qc.invalidateQueries({ queryKey: welfareKeys.pool }),
  });
}
