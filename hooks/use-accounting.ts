import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { accountingApi } from '@/lib/api/endpoints';

export const accountingKeys = {
  accounts:      ['accounting', 'accounts'] as const,
  journals:      (params?: Record<string, unknown>) => ['accounting', 'journals', params] as const,
  trialBalance:  ['accounting', 'trial-balance'] as const,
  pnl:           (from: string, to: string) => ['accounting', 'pnl', from, to] as const,
  balanceSheet:  (asOf?: string) => ['accounting', 'balance-sheet', asOf] as const,
  fiscalPeriods: ['accounting', 'fiscal-periods'] as const,
};

export function useAccounts() {
  return useQuery({ queryKey: accountingKeys.accounts, queryFn: accountingApi.listAccounts });
}

export function useJournals(params?: Record<string, unknown>) {
  return useQuery({ queryKey: accountingKeys.journals(params), queryFn: () => accountingApi.journals(params) });
}

export function useTrialBalance() {
  return useQuery({ queryKey: accountingKeys.trialBalance, queryFn: accountingApi.trialBalance });
}

export function useProfitAndLoss(from: string, to: string) {
  return useQuery({
    queryKey: accountingKeys.pnl(from, to),
    queryFn:  () => accountingApi.profitAndLoss(from, to),
    enabled:  !!(from && to),
  });
}

export function useBalanceSheet(asOf?: string) {
  return useQuery({ queryKey: accountingKeys.balanceSheet(asOf), queryFn: () => accountingApi.balanceSheet(asOf) });
}

export function useCreateJournal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => accountingApi.createJournal(body),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['accounting'] }),
  });
}

export function useFiscalPeriods() {
  return useQuery({ queryKey: accountingKeys.fiscalPeriods, queryFn: accountingApi.fiscalPeriods });
}

export function useClosePeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { periodStart: string; periodEnd: string }) => accountingApi.closePeriod(body),
    onSuccess:  () => qc.invalidateQueries({ queryKey: accountingKeys.fiscalPeriods }),
  });
}

export function useReopenPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => accountingApi.reopenPeriod(id, { reason }),
    onSuccess:  () => qc.invalidateQueries({ queryKey: accountingKeys.fiscalPeriods }),
  });
}
