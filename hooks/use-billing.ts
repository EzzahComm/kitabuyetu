import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { billingApi, mpesaApi, smsApi } from '@/lib/api/endpoints';
import type { StkPushInput } from '@/lib/validators/mpesa.schema';
import type { UpgradePlanInput } from '@/lib/validators/billing.schema';
import type { SubscriptionProduct } from '@/types/enums';

export const billingKeys = {
  // Keyed BY PRODUCT. Plans are priced per product, so a single shared key
  // would let the Kitabu Yetu billing page and the Chama Reminder subscribe
  // page serve each other's cached prices — and the server verifies the amount
  // paid against its own table, so the mismatch surfaces as a failed payment.
  plans:       (product?: SubscriptionProduct) =>
                 ['billing', 'plans', product ?? 'kitabu_yetu'] as const,
  invoices:    ['billing', 'invoices'] as const,
  smsCredits:  ['billing', 'sms-credits'] as const,
  entitlements: ['billing', 'entitlements'] as const,
};

export function useBillingPlans(product?: SubscriptionProduct) {
  return useQuery({
    queryKey: billingKeys.plans(product),
    queryFn:  () => billingApi.plans(product),
  });
}

export function useInvoices() {
  return useQuery({ queryKey: billingKeys.invoices, queryFn: billingApi.invoices });
}

export function useSmsCreditBalance() {
  return useQuery({ queryKey: billingKeys.smsCredits, queryFn: smsApi.creditBalance });
}

export function useUpgradePlan(product?: SubscriptionProduct) {
  const qc = useQueryClient();
  return useMutation({
    // Claims a completed M-Pesa payment rather than upgrading outright — the
    // server refuses if no unconsumed payment exists for this plan.
    //
    // `product` has to be threaded: without it this claimed a kitabu_yetu
    // payment no matter which product the user actually paid for, so a Chama
    // Reminder purchase would find no claimable payment and fail.
    mutationFn: (planType: UpgradePlanInput['planType']) =>
                  billingApi.upgradePlan(planType, product),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: billingKeys.plans(product) });
      // Buying a product changes what this session may reach, and the portal
      // shells gate on it.
      qc.invalidateQueries({ queryKey: billingKeys.entitlements });
    },
  });
}

export function useStkPush() {
  return useMutation({
    mutationFn: (body: StkPushInput) => mpesaApi.stkPush(body),
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
