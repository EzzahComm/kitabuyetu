import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { loansApi } from '@/lib/api/endpoints';

export const loanKeys = {
  all:    ['loans'] as const,
  list:   (params?: Record<string, unknown>) => [...loanKeys.all, 'list', params] as const,
  detail: (id: string) => [...loanKeys.all, id] as const,
};

export function useLoans(params?: Record<string, unknown>) {
  return useQuery({
    queryKey: loanKeys.list(params),
    queryFn:  () => loansApi.list(params),
  });
}

export function useLoan(id: string) {
  return useQuery({
    queryKey: loanKeys.detail(id),
    queryFn:  () => loansApi.getById(id),
    enabled:  !!id,
  });
}

/** Effective group loan terms (advisory defaults for the application form). */
export function useLoanPolicy() {
  return useQuery({
    queryKey: [...loanKeys.all, 'policy'],
    queryFn:  () => loansApi.policy(),
  });
}

export function useSetLoanPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => loansApi.setPolicy(body),
    onSuccess:  () => qc.invalidateQueries({ queryKey: [...loanKeys.all, 'policy'] }),
  });
}

export function useApplyLoan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => loansApi.apply(body),
    onSuccess:  () => qc.invalidateQueries({ queryKey: loanKeys.all }),
  });
}

export function useLoanAction(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => loansApi.action(id, body),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: loanKeys.list() });
      qc.invalidateQueries({ queryKey: loanKeys.detail(id) });
    },
  });
}

export function useRecordRepayment(loanId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => loansApi.recordRepayment(loanId, body),
    onSuccess:  () => qc.invalidateQueries({ queryKey: loanKeys.detail(loanId) }),
  });
}
