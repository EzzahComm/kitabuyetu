import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { buildQuery } from '@/lib/utils';
import type { welfareService , CreateWelfareRequestPayload, ReviewWelfareRequestPayload, RecordWelfarePoolPayload } from '@/lib/services/welfare.service';
import type { PaginatedResult } from '@/types/db.types';

const BASE = '/welfare';

export interface WelfareRequestRow {
  id:                string;
  member_id:         string;
  request_type:      string;
  title:             string;
  description:       string | null;
  amount_requested:  string;
  amount_approved:   string | null;
  amount_disbursed:  string | null;
  status:            string;
  priority:          string;
  member_name:       string;
  member_phone?:     string;
  approved_by_name?: string | null;
  disbursed_by_name?: string | null;
  reviewed_at:       string | null;
  approved_at:       string | null;
  disbursed_at:      string | null;
  rejected_at:       string | null;
  rejection_reason:  string | null;
  notes:             string | null;
  created_at:        string;
}

export type WelfarePoolSummary = Awaited<ReturnType<typeof welfareService.getPoolSummary>>;

export interface WelfarePoolResponse {
  summary:       WelfarePoolSummary;
  /** Not modeled precisely — not consumed client-side today (no page_size in the real response). */
  contributions: unknown;
}

export const welfareKeys = {
  all:    ['welfare'] as const,
  list:   (p?: Record<string, unknown>) => [...welfareKeys.all, 'list', p] as const,
  detail: (id: string) => [...welfareKeys.all, id] as const,
  pool:   ['welfare', 'pool'] as const,
};

export function useWelfareRequests(params?: Record<string, unknown>, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: welfareKeys.list(params),
    queryFn:  () => api.get<PaginatedResult<WelfareRequestRow>>(`${BASE}${buildQuery(params ?? {})}`),
    enabled:  opts?.enabled,
  });
}

export function useWelfareRequest(id: string) {
  return useQuery({
    queryKey: welfareKeys.detail(id),
    queryFn:  () => api.get<WelfareRequestRow>(`${BASE}/${id}`),
    enabled:  !!id,
  });
}

export function useCreateWelfareRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateWelfareRequestPayload) => api.post<WelfareRequestRow>(BASE, body),
    onSuccess:  () => qc.invalidateQueries({ queryKey: welfareKeys.all }),
  });
}

export function useReviewWelfareRequest(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ReviewWelfareRequestPayload) => api.patch<WelfareRequestRow>(`${BASE}/${id}`, body),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: welfareKeys.list() });
      qc.invalidateQueries({ queryKey: welfareKeys.detail(id) });
    },
  });
}

export function useWelfarePool(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: welfareKeys.pool,
    queryFn:  () => api.get<WelfarePoolResponse>(`${BASE}/pool`),
    enabled:  opts?.enabled,
  });
}

export function useRecordWelfarePoolContribution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RecordWelfarePoolPayload) => api.post<unknown>(`${BASE}/pool`, body),
    onSuccess:  () => qc.invalidateQueries({ queryKey: welfareKeys.pool }),
  });
}
