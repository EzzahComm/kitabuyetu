'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Shield } from 'lucide-react';
import { AdminSidebar } from '@/components/admin/sidebar';
import { AdminTopbar } from '@/components/admin/topbar';
import { CommandPalette } from '@/components/admin/command-palette';
import { useAuth } from '@/lib/auth/context';
import { configureApiClient } from '@/lib/api/client';

/**
 * Guards the entire /admin portal. Phase 1 of the backoffice isolation:
 *
 * 1. The user must be signed in via /admin-login (audience === 'backoffice').
 *    A tenant token, even from a super_admin who has been signed in on the
 *    consumer side, is NOT accepted here — that's enforced server-side by
 *    the proxy too; this guard just renders a clean redirect.
 * 2. The token's platform role must be super_admin or support.
 *
 * PRODUCTION_READINESS_AUDIT Pass 1 (docs/audit/01-HYPOTHESIS-VERIFICATION.md,
 * H7) found `organization_coordinator` no longer reaches this page at all —
 * the org-login-architecture split (app/api/v1/auth/admin/login/route.ts's
 * SURFACE_ALLOWED_ROLES) restricts the 'platform' surface /admin-login uses
 * to super_admin/support only; org_coordinator signs in via /enterprise/login
 * instead — and dropped it from this list accordingly.
 *
 * `support` was ALSO dropped at that point, because every one of the 48 route
 * handlers under app/api/admin/** gated on `withPlatformRole(req,
 * 'super_admin', ...)` specifically, so a support login passed this shell and
 * 403'd on every fetch behind it. Restored here once real (read-only) support
 * access was decided and shipped: every GET handler under app/api/admin/**
 * now accepts `['super_admin', 'support']`; every mutating handler (POST/PUT/
 * PATCH/DELETE) is still super_admin-only, including
 * app/api/admin/support/[id]'s own PATCH (ticket status) — support can see
 * every ticket but not yet act on one; a deliberate scope line, not an
 * oversight, revisit if that turns out to be too narrow in practice.
 *
 * Visual treatment is intentionally distinct (red accent + persistent
 * "BACKOFFICE" badge) so staff never mistake the privileged context for
 * a tenant dashboard.
 */
const ADMIN_ROLES = ['super_admin', 'support'] as const;
type AdminRole = (typeof ADMIN_ROLES)[number];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, accessToken, audience, logout, isLoading } = useAuth();
  const router = useRouter();

  // Wire up the API client with the current token. onUnauthorized bounces
  // back to /admin-login (not /login) so a stale backoffice session lands
  // on the right re-auth page.
  useEffect(() => {
    configureApiClient({
      getToken:       () => accessToken ?? null,
      onUnauthorized: () => { logout(); router.push('/admin-login'); },
    });
  }, [accessToken, logout, router]);

  useEffect(() => {
    if (isLoading) return;
    if (!user || audience !== 'backoffice') {
      router.replace('/admin-login');
      return;
    }
    if (!ADMIN_ROLES.includes(user.platformRole as AdminRole)) {
      // Signed in to backoffice but role isn't recognised — defensive,
      // shouldn't be reachable since the login route enforces the same
      // allowlist before issuing a token. Genuinely authenticated-but-denied,
      // so this goes to /unauthorized, not back to the login page they just
      // came from (which would just be a confusing dead-end loop).
      router.replace('/unauthorized');
    }
  }, [user, audience, isLoading, router]);

  const ready = !isLoading
    && !!user
    && audience === 'backoffice'
    && ADMIN_ROLES.includes(user.platformRole as AdminRole);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-400">Verifying backoffice access…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <CommandPalette />
      <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Backoffice indicator strip — always visible so staff don't
            confuse this surface with the consumer dashboard. */}
        <div className="h-1 w-full bg-red-600" aria-hidden />
        <div className="flex items-center gap-2 bg-red-50 border-b border-red-200 px-4 py-1.5 text-xs text-red-900">
          <Shield className="h-3.5 w-3.5" />
          <span className="font-medium uppercase tracking-wide">Backoffice</span>
          <span className="text-red-700/70">·</span>
          <span className="text-red-700/80">Actions in this portal are logged.</span>
          <span className="ml-auto font-mono">{user.platformRole}</span>
        </div>

        <AdminTopbar onMenuClick={() => setSidebarOpen(true)} />

        <main className="flex-1 overflow-y-auto">
          <div className="p-6 max-w-[1600px] mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
