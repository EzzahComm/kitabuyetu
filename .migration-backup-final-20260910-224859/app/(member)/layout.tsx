'use client';

import * as React from 'react';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Bell, LayoutDashboard } from 'lucide-react';
import { MemberBottomNav } from '@/components/member/bottom-nav';
import { OfflineIndicator } from '@/components/member/offline-indicator';
import { useAuth, isBackofficeUser, isTenantUser } from '@/lib/auth/context';
import { configureApiClient } from '@/lib/api/client';
import { useUnreadNotificationCount } from '@/hooks/use-member';

/**
 * Member self-service shell — mobile-first by construction.
 *
 * Content is constrained to a phone-width column (max-w-md) and centred on
 * larger screens, so the same layout reads naturally on a feature-ish Android
 * phone and on a desktop. A sticky top bar carries the greeting + sync status;
 * a fixed bottom tab bar carries primary navigation.
 *
 * Auth guard mirrors app/(dashboard)/layout.tsx exactly — see that file for
 * the reasoning behind each check (backoffice sessions never render here,
 * pending_verification groups get bounced to /verify-group, etc.).
 */
export default function MemberLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading, accessToken, audience, logout } = useAuth();
  const router = useRouter();
  const isBackoffice = audience === 'backoffice' || isBackofficeUser(user);

  useEffect(() => {
    configureApiClient({
      getToken:       () => accessToken,
      onUnauthorized: () => { logout(); router.push('/login'); },
    });
  }, [accessToken, logout, router]);

  useEffect(() => {
    if (isLoading) return;
    if (!user) { router.push('/login'); return; }
    if (isBackoffice) { router.replace('/admin'); return; }
    if (isTenantUser(user) && user.groupStatus === 'pending_verification') {
      router.replace('/verify-group');
    }
  }, [isLoading, user, isBackoffice, router]);

  const { data: unreadCount } = useUnreadNotificationCount({ enabled: !isLoading && !!user && !isBackoffice });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500" />
      </div>
    );
  }

  if (!user || isBackoffice || !isTenantUser(user)) return null;

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="mx-auto flex min-h-screen max-w-md flex-col bg-background shadow-sm">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-blue-600 text-sm font-bold text-white">
            {user.firstName[0]}{user.lastName[0]}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-tight text-foreground">
              Hi, {user.firstName} 👋
            </p>
            <p className="truncate text-xs text-muted-foreground">{user.groupName}</p>
          </div>
          <OfflineIndicator className="hidden sm:inline-flex" />
          {
            // UX_UI_OPTIMIZATION_AUDIT_2026-08.md Phase 1 (C3): /me now
            // defaults for plain members, but the reverse path must stay
            // reachable — an officer viewing a group where they hold plain
            // 'member' status, or a member who just wants the full app,
            // shouldn't be stuck here with no way out.
          }
          <Link
            href="/dashboard"
            className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted"
            aria-label="Switch to full dashboard"
            title="Full dashboard"
          >
            <LayoutDashboard size={20} />
          </Link>
          <Link
            href="/me/notifications"
            className="relative rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted"
            aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
          >
            <Bell size={20} />
            {!!unreadCount && unreadCount > 0 && (
              <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-bold text-white">
                {unreadCount}
              </span>
            )}
          </Link>
        </header>

        {/* Scrollable content — bottom padding clears the fixed tab bar */}
        <main className="flex-1 px-4 pb-24 pt-4">{children}</main>

        <MemberBottomNav />
      </div>
    </div>
  );
}
