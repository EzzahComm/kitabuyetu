import { useQuery } from '@tanstack/react-query';
import { billingApi } from '@/lib/api/endpoints';
import { billingKeys } from './use-billing';
import type { SubscriptionProduct } from '@/types/enums';

/**
 * Which products this group may actually use, and which one it signed up for.
 *
 * Fetched rather than read off the JWT, deliberately. The server gate re-reads
 * live so that paying unlocks immediately (lib/auth/subscription-gate.ts); a
 * token claim would keep the client denying for a full access-token TTL after
 * payment, leaving client and server disagreeing about a fact the user just
 * paid money to change. It would also mean touching jwt.ts, the proxy's header
 * stamping, AuthContext and four token-issuance sites, against one route and
 * one hook here.
 *
 * 30s staleTime rather than 0: the portal shells call this on every navigation,
 * and buying a plan invalidates the key explicitly (see useUpgradePlan), so the
 * only thing the stale window can delay is an entitlement change made in
 * another tab or by support.
 */
export function useEntitlements() {
  const query = useQuery({
    queryKey:  billingKeys.entitlements,
    queryFn:   billingApi.entitlements,
    staleTime: 30_000,
  });

  const products = query.data?.products ?? [];

  return {
    ...query,
    products,
    signupProduct: query.data?.signupProduct,
    has: (product: SubscriptionProduct) => products.includes(product),
    /**
     * True for a group that holds Chama Reminder and NOT Kitabu Yetu — the
     * standalone case that must never be sent to the Kitabu Yetu dashboard.
     * A group holding both is a Kitabu Yetu group with an add-on and belongs
     * on its normal dashboard.
     */
    reminderOnly:
      products.includes('chama_reminder') && !products.includes('kitabu_yetu'),
    /**
     * True for a group that has not paid for anything yet but registered for
     * Chama Reminder. `products` cannot answer this — since migration 139 a
     * never-paid group holds no subscription at all, so without signupProduct
     * it is indistinguishable from an unpaid Kitabu Yetu group and would be
     * sent to the wrong subscribe page.
     */
    awaitingReminderPayment:
      products.length === 0 && query.data?.signupProduct === 'chama_reminder',
  };
}
