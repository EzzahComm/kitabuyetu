'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { TopBar } from '@/components/layout/topbar';
import { CommandPalette } from '@/components/layout/command-palette';
import { useAuth, isBackofficeUser, isTenantUser } from '@/lib/auth/context';
import { useEntitlements } from '@/hooks/use-entitlements';
import { configureApiClient } from '@/lib/api/client';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, isLoading, accessToken, audience, logout } = useAuth();
  const router = useRouter();
  const entitlements = useEntitlements();

  // Read as values, not as the object: useEntitlements returns a fresh object
  // each render, so depending on it directly would re-run the effect endlessly.
  const entitlementsLoading = entitlements.isLoading;
  const reminderOnly        = entitlements.reminderOnly;

  // A backoffice (staff) session must never render the tenant dashboard —
  // otherwise a super-admin who follows a stray link lands in the consumer
  // shell and appears to be "inside a group called Kitabu Yetu". Send them
  // back to the backoffice portal instead.
  const isBackoffice = audience === 'backoffice' || isBackofficeUser(user);

  useEffect(() => {
    configureApiClient({
      getToken:       () => accessToken,
      onUnauthorized: () => { logout(); router.push('/login'); },
      // 402: the group's subscription lapsed or was never paid for. Billing is
      // outside the lock precisely so this redirect lands somewhere usable —
      // the user can pick a plan and pay from there. Never redirect while
      // already on /billing, or paying would bounce the page mid-flow.
      onPaymentRequired: () => {
        if (!window.location.pathname.startsWith('/billing')) router.push('/billing');
      },
    });
  }, [accessToken, logout, router]);

  useEffect(() => {
    if (isLoading) return;
    if (!user) { router.push('/login'); return; }
    if (isBackoffice) { router.replace('/admin'); return; }
    // Every feature route 403s server-side for a pending_verification group
    // (proxy.ts) — redirect client-side too so the user sees the
    // verification flow instead of a page full of failed requests.
    if (isTenantUser(user) && user.groupStatus === 'pending_verification') {
      router.replace('/verify-group');
      return;
    }
    // Same reasoning, one axis over (migration 140): a group holding only
    // Chama Reminder is refused every financial route, so this shell would
    // render a page of 402s. Reached by a stale bookmark or a shared link,
    // not by any flow in the app. Wait for entitlements rather than guessing —
    // a wrong bounce here would eject a legitimate Kitabu Yetu user.
    if (!entitlementsLoading && reminderOnly) {
      router.replace('/reminder');
    }
  }, [isLoading, user, isBackoffice, router, entitlementsLoading, reminderOnly]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500" />
      </div>
    );
  }

  if (!user || isBackoffice) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
