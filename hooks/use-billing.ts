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
    refetchInterval: (data: any) => {
      if (data?.status === 'completed' || data?.status === 'failed') return false;
      return 3000;
    },
  });
}
