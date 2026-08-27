import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { buildQuery } from '@/lib/utils';
import type { investmentsService , CreateInvestmentPayload, UpdateInvestmentPayload, RecordReturnPayload, RecordExpensePayload } from '@/lib/services/investments.service';
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
  /** Sum of investment_expenses — computed, not a real column (migration 156). */
  total_expenses:       string;
  created_at:           string;
}

/** A row of `investment_returns`, as getById returns it. */
export interface InvestmentReturnRow {
  id:               string;
  investment_id:    string;
  return_type:      string;
  amount:           string;
  return_date:      string;
  receipt_number:   string | null;
  notes:            string | null;
  recorded_by_name: string;
  created_at:       string;
}

/** A row of `investment_expenses`, as getById returns it (migration 156). */
export interface InvestmentExpenseRow {
  id:               string;
  investment_id:    string;
  expense_type:     string;
  amount:           string;
  expense_date:     string;
  receipt_number:   string | null;
  notes:            string | null;
  recorded_by_name: string;
  created_at:       string;
}

/**
 * A member's contribution to one investment. `member_investment_shares` has no
 * writer anywhere in the product, so this is always empty today — the detail
 * page renders the section only when rows actually exist rather than showing
 * an empty table that implies a feature.
 */
export interface InvestmentShareRow {
  id:                 string;
  investment_id:      string;
  member_id:          string;
  member_name:        string;
  shares:             string | null;
  amount_contributed: string;
}

/** What GET /investments/:id returns — the row plus its children. */
export type InvestmentDetail = InvestmentRow & {
  approved_by_name: string | null;
  returns:          InvestmentReturnRow[];
  expenses:         InvestmentExpenseRow[];
  shares:           InvestmentShareRow[];
};

export type InvestmentSummary = Awaited<ReturnType<typeof investmentsService.getSummary>>;

export const investmentKeys = {
  all:     ['investments'] as const,
  /** Prefix for every list query, whatever its params — use this to invalidate. */
  lists:   () => [...investmentKeys.all, 'list'] as const,
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
    queryFn:  () => api.get<InvestmentDetail>(`${BASE}/${id}`),
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
      qc.invalidateQueries({ queryKey: investmentKeys.lists() });
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
      // The list's "Returns Earned" column is a SUM over investment_returns,
      // so it goes stale on a new return just like the summary does.
      qc.invalidateQueries({ queryKey: investmentKeys.lists() });
      qc.invalidateQueries({ queryKey: investmentKeys.summary });
    },
  });
}

export function useRecordInvestmentExpense(investmentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RecordExpensePayload) => api.post<unknown>(`${BASE}/${investmentId}/expenses`, body),
    // Same invalidation set as a return: an expense moves the list's totals
    // and the portfolio ROI, which is now net of expenses (migration 156).
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: investmentKeys.detail(investmentId) });
      qc.invalidateQueries({ queryKey: investmentKeys.lists() });
      qc.invalidateQueries({ queryKey: investmentKeys.summary });
    },
  });
}
