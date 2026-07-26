import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { billingApi, mpesaApi } from '@/lib/api/endpoints';

export const billingKeys = {
  plans:    ['billing', 'plans'] as const,
  invoices: ['billing', 'invoices'] as const,
};

export function useBillingPlans() {
  return useQuery({ queryKey: billingKeys.plans, queryFn: billingApi.plans });
}

export function useInvoices() {
  return useQuery({ queryKey: billingKeys.invoices, queryFn: billingApi.invoices });
}

export function useUpgradePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (planType: string) => billingApi.upgradePlan(planType),
    onSuccess:  () => qc.invalidateQueries({ queryKey: billingKeys.plans }),
  });
}

export function useStkPush() {
  return useMutation({
    mutationFn: (body: unknown) => mpesaApi.stkPush(body),
  });
}

export function usePollMpesa(checkoutRequestId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['mpesa', 'poll', checkoutRequestId],
    queryFn:  () => mpesaApi.pollStatus(checkoutRequestId!),
    enabled:  enabled && !!checkoutRequestId,
    // refetchInterval's callback receives the Query object, not its data
    // directly (query.state.data) — the previous `(data: any) => data?.status`
    // read a `.status` field that doesn't exist on a Query, so polling never
    // actually stopped on its own once the payment completed/failed; it kept
    // firing every 3s until something else (e.g. `enabled` going false)
    // stopped it.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'completed' || status === 'failed') return false;
      return 3000;
    },
  });
}
