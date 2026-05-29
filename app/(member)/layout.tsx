import * as React from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { MemberBottomNav } from '@/components/member/bottom-nav';
import { OfflineIndicator } from '@/components/member/offline-indicator';
import { member, notificationsCount } from './_data';

/**
 * Member self-service shell — mobile-first by construction.
 *
 * Content is constrained to a phone-width column (max-w-md) and centred on
 * larger screens, so the same layout reads naturally on a feature-ish Android
 * phone and on a desktop. A sticky top bar carries the greeting + sync status;
 * a fixed bottom tab bar carries primary navigation.
 *
 * NOTE: in production this group should be wrapped with the same auth guard as
 * (dashboard) — gated to the member's own membership. It's left ungated here so
 * the UI is reviewable in isolation.
 */
export default function MemberLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/30">
      <div className="mx-auto flex min-h-screen max-w-md flex-col bg-background shadow-sm">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-blue-600 text-sm font-bold text-white">
            {member.firstName[0]}{member.lastName[0]}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-tight text-foreground">
              Hi, {member.firstName} 👋
            </p>
            <p className="truncate text-xs text-muted-foreground">{member.groupName}</p>
          </div>
          <OfflineIndicator className="hidden sm:inline-flex" />
          <Link
            href="/me/notifications"
            className="relative rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted"
            aria-label={`Notifications${notificationsCount ? `, ${notificationsCount} unread` : ''}`}
          >
            <Bell size={20} />
            {notificationsCount > 0 && (
              <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-bold text-white">
                {notificationsCount}
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
