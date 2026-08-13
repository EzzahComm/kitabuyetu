import type { SubscriptionProduct } from '@/types/enums';

/** What a session is entitled to. Both optional — callers that have neither get the old behaviour. */
export interface PostLoginEntitlements {
  products?:      SubscriptionProduct[];
  signupProduct?: SubscriptionProduct;
}

/**
 * UX_UI_OPTIMIZATION_AUDIT_2026-08.md Phase 1 (C3): a plain 'member' — who
 * holds none of the officer permissions (dashboard.view/meetings.view only)
 * — previously always landed on the full officer dashboard, where nearly
 * every action is a permission dead-end, while the simplified (member)
 * portal built for their access level sat completely unreachable.
 * Chairperson/treasurer/secretary keep landing on /dashboard; they need its
 * officer tooling. Used at both fresh login and group-switch time, since
 * switching groups can change which role applies.
 *
 * Migration 140 added a second axis ahead of role: WHICH PRODUCT. A group that
 * holds only Chama Reminder has no chart of accounts and is refused every
 * financial route, so sending it to /dashboard produces a page of 402s. It
 * belongs on /reminder.
 *
 * `signupProduct` is what handles the never-paid case, and it cannot be derived
 * from `products`: since migration 139 a brand-new group holds no subscription
 * at all, so a standalone Chama Reminder registrant looks exactly like an
 * unpaid Kitabu Yetu one until you ask what it signed up for.
 *
 * A group holding BOTH products is a Kitabu Yetu group with an add-on and keeps
 * landing on /dashboard — the reminder portal is reachable from there, and
 * demoting a full customer to the lighter product would be a downgrade.
 */
export function postLoginPath(
  groupRole?: string,
  entitlements?: PostLoginEntitlements,
): string {
  const products = entitlements?.products ?? [];

  const reminderOnly = !products.includes('kitabu_yetu')
    && (products.includes('chama_reminder')
        || (products.length === 0 && entitlements?.signupProduct === 'chama_reminder'));

  if (reminderOnly) return '/reminder';

  return groupRole === 'member' ? '/me' : '/dashboard';
}

/**
 * postLoginPath, with the entitlement lookup done for you.
 *
 * For the handful of places that route a session immediately after
 * login/verify/switch and have no entitlements to hand. Deliberately NOT
 * useEntitlements: these run inside async submit handlers, after a token
 * change, where a hook's cached value would be the PREVIOUS session's.
 *
 * Falls back to the plain role-based path if the lookup fails, which is the
 * pre-migration-140 behaviour — a routing helper must not be able to strand
 * someone who has just signed in.
 */
export async function resolvePostLoginPath(groupRole?: string): Promise<string> {
  const { billingApi } = await import('@/lib/api/endpoints');
  const entitlements = await billingApi.entitlements().catch(() => undefined);
  return postLoginPath(groupRole, entitlements);
}
