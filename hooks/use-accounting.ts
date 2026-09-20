import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { accountingApi } from '@/lib/api/endpoints';
import type {
  CreateJournalPayload,
  SetPostingTemplatePayload,
  ClosePeriodInput,
  ReopenPeriodInput,
  SetApprovalPolicyInput,
} from '@/lib/validators/accounting.schema';

export const accountingKeys = {
  accounts: ['accounting', 'accounts'] as const,
  journals: (params?: Record<string, unknown>) => ['accounting', 'journals', params] as const,
  trialBalance: ['accounting', 'trial-balance'] as const,
  pnl: (from: string, to: string) => ['accounting', 'pnl', from, to] as const,
  balanceSheet: (asOf?: string) => ['accounting', 'balance-sheet', asOf] as const,
  fiscalPeriods: ['accounting', 'fiscal-periods'] as const,
  policies: ['accounting', 'policies'] as const,
  postingTemplates: ['accounting', 'posting-templates'] as const,
};

// enabled defaults to true everywhere below so every existing caller keeps
// working unchanged; accounting/page.tsx is the one caller that now passes
// tab === '<name>' explicitly, since all 9 of these previously fired
// unconditionally on every /accounting load regardless of which of 8 tabs
// was open — 13 SQL statements across 9 withDb() calls per view
// (docs/audits/optimization-2026-09).
export function useAccounts(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: accountingKeys.accounts,
    queryFn: accountingApi.listAccounts,
    enabled: opts?.enabled ?? true,
  });
}

export function useJournals(params?: Record<string, unknown>, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: accountingKeys.journals(params),
    queryFn: () => accountingApi.journals(params),
    enabled: opts?.enabled ?? true,
  });
}

export function useTrialBalance(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: accountingKeys.trialBalance,
    queryFn: accountingApi.trialBalance,
    enabled: opts?.enabled ?? true,
  });
}

export function useProfitAndLoss(from: string, to: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: accountingKeys.pnl(from, to),
    queryFn: () => accountingApi.profitAndLoss(from, to),
    enabled: !!(from && to) && (opts?.enabled ?? true),
  });
}

export function useBalanceSheet(asOf?: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: accountingKeys.balanceSheet(asOf),
    queryFn: () => accountingApi.balanceSheet(asOf),
    enabled: opts?.enabled ?? true,
  });
}

export function useCreateJournal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateJournalPayload) => accountingApi.createJournal(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounting'] }),
  });
}

export function useFiscalPeriods(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: accountingKeys.fiscalPeriods,
    queryFn: accountingApi.fiscalPeriods,
    enabled: opts?.enabled ?? true,
  });
}

export function useClosePeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ClosePeriodInput) => accountingApi.closePeriod(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: accountingKeys.fiscalPeriods }),
  });
}

export function useReopenPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string } & ReopenPeriodInput) => accountingApi.reopenPeriod(id, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: accountingKeys.fiscalPeriods }),
  });
}

export function useCashFlow(from: string, to: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['accounting', 'cash-flow', from, to] as const,
    queryFn: () => accountingApi.cashFlow(from, to),
    enabled: !!(from && to) && (opts?.enabled ?? true),
  });
}

export function useEquityChanges(from: string, to: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['accounting', 'equity-changes', from, to] as const,
    queryFn: () => accountingApi.equityChanges(from, to),
    enabled: !!(from && to) && (opts?.enabled ?? true),
  });
}

export function usePostingTemplates() {
  return useQuery({ queryKey: accountingKeys.postingTemplates, queryFn: accountingApi.postingTemplates });
}

export function useSetPostingTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SetPostingTemplatePayload) => accountingApi.setPostingTemplate(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: accountingKeys.postingTemplates }),
  });
}

export function useApprovalPolicies(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: accountingKeys.policies,
    queryFn: accountingApi.policies,
    enabled: opts?.enabled ?? true,
  });
}

export function useSetApprovalPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SetApprovalPolicyInput) => accountingApi.setPolicy(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: accountingKeys.policies }),
  });
}
