'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { TopBar } from '@/components/layout/topbar';
import { CommandPalette } from '@/components/layout/command-palette';
import { useEntitlements } from '@/hooks/use-entitlements';
import { useApiClientAuth, useTenantShellGuard } from '@/hooks/use-shell-auth';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const router = useRouter();
  const entitlements = useEntitlements();

  // Read as values, not as the object: useEntitlements returns a fresh object
  // each render, so depending on it directly would re-run effects endlessly.
  const entitlementsLoading = entitlements.isLoading;
  const reminderOnly = entitlements.reminderOnly;

  // 402: the group's subscription lapsed or was never paid for. Billing is
  // outside the lock precisely so this redirect lands somewhere usable —
  // the user can pick a plan and pay from there. Never redirect while
  // already on /billing, or paying would bounce the page mid-flow.
  useApiClientAuth('/login', () => {
    if (!window.location.pathname.startsWith('/billing')) router.push('/billing');
  });

  // A group holding only Chama Reminder is refused every financial route
  // (migration 140), so this shell would render a page of 402s. Wait for
  // entitlements rather than guessing — a wrong bounce here would eject a
  // legitimate Kitabu Yetu user.
  const { user, isLoading, isBackoffice } = useTenantShellGuard(
    !entitlementsLoading && reminderOnly ? '/reminder' : null,
  );

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
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
      <CommandPalette />
    </div>
  );
}
