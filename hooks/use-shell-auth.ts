'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, isBackofficeUser, isTenantUser } from '@/lib/auth/context';
import { configureApiClient } from '@/lib/api/client';

/**
 * Wires the API client to the current session. A 401 logs out and bounces to
 * `loginPath`; `onPaymentRequired` (402) is optional and shell-specific.
 */
export function useApiClientAuth(loginPath: string, onPaymentRequired?: () => void) {
  const { accessToken, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    configureApiClient({
      getToken: () => accessToken ?? null,
      onUnauthorized: () => {
        logout();
        router.push(loginPath);
      },
      ...(onPaymentRequired ? { onPaymentRequired } : {}),
    });
    // onPaymentRequired is intentionally excluded: callers pass an inline
    // closure, and including it would reconfigure the client every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, logout, router, loginPath]);
}

/**
 * Redirect guard shared by the tenant shells (/dashboard, /me).
 *
 * - no session            -> /login
 * - backoffice session    -> /admin (staff must never render a tenant shell)
 * - pending_verification  -> /verify-group
 * - `extraRedirect`       -> checked last, so it never races the above
 */
export function useTenantShellGuard(extraRedirect: string | null = null) {
  const { user, isLoading, audience } = useAuth();
  const router = useRouter();
  const isBackoffice = audience === 'backoffice' || isBackofficeUser(user);

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.push('/login');
      return;
    }
    if (isBackoffice) {
      router.replace('/admin');
      return;
    }
    if (isTenantUser(user) && user.groupStatus === 'pending_verification') {
      router.replace('/verify-group');
      return;
    }
    if (extraRedirect) router.replace(extraRedirect);
  }, [isLoading, user, isBackoffice, router, extraRedirect]);

  return { user, isLoading, isBackoffice };
}
