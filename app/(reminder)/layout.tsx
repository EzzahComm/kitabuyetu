'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Users2, Send, BellRing, Megaphone,
  LayoutTemplate, Cake, BarChart2, CreditCard, Menu,
} from 'lucide-react';
import { useAuth, isBackofficeUser, isTenantUser } from '@/lib/auth/context';
import { useEntitlements } from '@/hooks/use-entitlements';
import { configureApiClient } from '@/lib/api/client';
import { postLoginPath } from '@/lib/auth/post-login-path';
import { PortalSidebar, type PortalNavSection } from '@/components/shared/portal-sidebar';

/**
 * Chama Reminder portal shell.
 *
 * Deliberately narrower than the Kitabu Yetu dashboard: this product is SMS
 * only, so there is no contributions, loans or accounting surface here — and
 * a Chama-Reminder-only group has no chart of accounts to back one. The server
 * enforces that independently (lib/auth/subscription-gate.ts); this shell just
 * keeps the user from being shown doors that would 402.
 *
 * Gating is on ENTITLEMENT, not role — which is what makes it different from
 * every other portal in the app. A chairperson is a chairperson in both
 * products; what separates them is what the group paid for.
 */

/** The one page a group that has not paid yet is allowed to reach. */
const SUBSCRIBE_PATH = '/reminder/subscription';

const NAV: PortalNavSection[] = [
  {
    title: 'Overview',
    items: [
      { href: '/reminder',            label: 'Dashboard', icon: LayoutDashboard },
      { href: '/reminder/members',    label: 'Members',   icon: Users2 },
    ],
  },
  {
    title: 'Messaging',
    items: [
      { href: '/reminder/messages',   label: 'Messages',  icon: Send },
      { href: '/reminder/campaigns',  label: 'Campaigns', icon: Megaphone },
      { href: '/reminder/templates',  label: 'Templates', icon: LayoutTemplate },
      { href: '/reminder/birthdays',  label: 'Birthdays', icon: Cake },
      // Meeting/event/custom reminders are Phase 5 — there is no table, job or
      // service behind them yet. `soon` shows the planned IA as a disabled item
      // rather than a link into a 404.
      { href: '/reminder/reminders',  label: 'Reminders', icon: BellRing, soon: true },
    ],
  },
  {
    title: 'Account',
    items: [
      { href: '/reminder/usage',        label: 'SMS Usage',    icon: BarChart2 },
      { href: SUBSCRIBE_PATH,           label: 'Subscription', icon: CreditCard },
    ],
  },
];

export default function ReminderLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router   = useRouter();
  const [open, setOpen] = React.useState(false);
  const { user, isLoading, accessToken, audience, logout } = useAuth();
  const entitlements = useEntitlements();

  const isBackoffice = audience === 'backoffice' || isBackofficeUser(user);
  const onSubscribePage = pathname === SUBSCRIBE_PATH;

  // Hoisted out of the effect deliberately. useEntitlements returns a fresh
  // object every render (it spreads the query result), so depending on it
  // directly would re-run the redirect effect on every render; depending on
  // its *values* keeps the effect keyed to what actually changed.
  const entitlementsLoading = entitlements.isLoading;
  const hasReminder         = entitlements.has('chama_reminder');
  const awaitingPayment     = entitlements.awaitingReminderPayment;
  const products            = entitlements.products;
  const signupProduct       = entitlements.signupProduct;

  React.useEffect(() => {
    configureApiClient({
      getToken:       () => accessToken,
      onUnauthorized: () => { logout(); router.push('/login'); },
      // Both 402s land here. PRODUCT_NOT_ENTITLED means this group pays for
      // Chama Reminder but the page reached for something else — sending it to
      // the subscribe page would be nonsense, so it goes home. Anything else
      // means it owes money, and the subscribe page is where that is fixed.
      onPaymentRequired: (code) => {
        if (code === 'PRODUCT_NOT_ENTITLED') { router.replace('/reminder'); return; }
        if (!onSubscribePage) router.replace(SUBSCRIBE_PATH);
      },
    });
  }, [accessToken, logout, router, onSubscribePage]);

  React.useEffect(() => {
    if (isLoading || entitlementsLoading) return;
    if (!user) { router.push('/login'); return; }
    if (isBackoffice) { router.replace('/admin'); return; }
    if (isTenantUser(user) && user.groupStatus === 'pending_verification') {
      router.replace('/verify-group'); return;
    }
    if (hasReminder) return;

    // Registered for Chama Reminder but has not paid: it holds no subscription
    // at all, so `products` is empty and only signup_product knows where it
    // belongs. Let it reach exactly one page — the one that ends the lock.
    // This mirrors the server's own carve-out: a lock that also blocks paying
    // is an outage, not a business model.
    if (awaitingPayment) {
      if (!onSubscribePage) router.replace(SUBSCRIBE_PATH);
      return;
    }

    // Anything else — a Kitabu Yetu group, or a group with nothing at all —
    // belongs on its own portal, not this one.
    router.replace(postLoginPath(
      isTenantUser(user) ? user.groupRole : undefined,
      { products, signupProduct },
    ));
  }, [
    isLoading, user, isBackoffice, router, onSubscribePage,
    entitlementsLoading, hasReminder, awaitingPayment, products, signupProduct,
  ]);

  const ready = !isLoading
    && !entitlementsLoading
    && !!user
    && !isBackoffice
    && (hasReminder || (awaitingPayment && onSubscribePage));

  const isActive = (href: string) =>
    href === '/reminder' ? pathname === href : pathname.startsWith(href);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading Chama Reminder…</p>
        </div>
      </div>
    );
  }

  const initials = isTenantUser(user)
    ? `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase() || '?'
    : '?';

  return (
    <div className="flex h-screen overflow-hidden bg-muted/30">
      <PortalSidebar
        open={open}
        onClose={() => setOpen(false)}
        variant="brand"
        sections={NAV}
        isActive={isActive}
        widthExpanded="w-[240px]"
        logo={() => (
          <Link href="/reminder" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-500 text-sm font-bold text-white">C</span>
            <span className="text-sm font-semibold text-foreground">Chama <span className="text-brand-600">Reminder</span></span>
          </Link>
        )}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted lg:hidden"
            aria-label="Open menu"
          >
            <Menu size={18} />
          </button>
          <div className="ml-auto flex items-center gap-3">
            {isTenantUser(user) && (
              <div className="hidden text-right leading-tight sm:block">
                <p className="text-xs font-medium text-foreground">{user.firstName} {user.lastName}</p>
                <p className="text-[11px] text-muted-foreground">{user.groupName}</p>
              </div>
            )}
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-blue-600 text-xs font-bold text-white">
              {initials}
            </span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1200px] p-4 lg:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
