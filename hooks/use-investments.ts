import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { buildQuery } from '@/lib/utils';
import type { investmentsService , CreateInvestmentPayload, UpdateInvestmentPayload, RecordReturnPayload } from '@/lib/services/investments.service';
import type { PaginatedResult } from '@/types/db.types';

const BASE = '/investments';

export interface InvestmentRow {
  id:                   string;
  name:                 string;
  description:          string | null;
  investment_type:      string;
  status:               string;
  principal_amount:     string;
  current_value:        string | null;
  expected_return_rate: string | null;
  start_date:           string;
  maturity_date:        string | null;
  custodian:            string | null;
  registration_number:  string | null;
  location:             string | null;
  liquidation_value:    string | null;
  notes:                string | null;
  created_by_name:      string;
  /** Sum of investment_returns for this investment — computed, not a real column. */
  total_returns:        string;
  created_at:           string;
}

export type InvestmentSummary = Awaited<ReturnType<typeof investmentsService.getSummary>>;

export const investmentKeys = {
  all:     ['investments'] as const,
  list:    (p?: Record<string, unknown>) => [...investmentKeys.all, 'list', p] as const,
  detail:  (id: string) => [...investmentKeys.all, id] as const,
  summary: ['investments', 'summary'] as const,
};

export function useInvestments(params?: Record<string, unknown>) {
  return useQuery({
    queryKey: investmentKeys.list(params),
    queryFn:  () => api.get<PaginatedResult<InvestmentRow>>(`${BASE}${buildQuery(params ?? {})}`),
  });
}

export function useInvestmentSummary() {
  return useQuery({
    queryKey: investmentKeys.summary,
    queryFn:  () => api.get<InvestmentSummary>(`${BASE}?summary=1`),
  });
}

export function useInvestment(id: string) {
  return useQuery({
    queryKey: investmentKeys.detail(id),
    queryFn:  () => api.get<InvestmentRow>(`${BASE}/${id}`),
    enabled:  !!id,
  });
}

export function useCreateInvestment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateInvestmentPayload) => api.post<InvestmentRow>(BASE, body),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: investmentKeys.all });
      qc.invalidateQueries({ queryKey: investmentKeys.summary });
    },
  });
}

export function useUpdateInvestment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateInvestmentPayload) => api.patch<InvestmentRow>(`${BASE}/${id}`, body),
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
    mutationFn: (body: RecordReturnPayload) => api.post<unknown>(`${BASE}/${investmentId}/returns`, body),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: investmentKeys.detail(investmentId) });
      qc.invalidateQueries({ queryKey: investmentKeys.summary });
    },
  });
}
