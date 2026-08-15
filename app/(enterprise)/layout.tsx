'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Network, Users2, Banknote, FileBarChart,
  KeyRound, Palette, ScrollText, Menu, Building2,
} from 'lucide-react';
import { useAuth } from '@/lib/auth/context';
import { WorkspaceSwitcher } from '@/components/enterprise/workspace-switcher';
import { PortalSidebar, type PortalNavSection } from '@/components/shared/portal-sidebar';

/**
 * B2B Enterprise portal shell — corporate, desktop-first, dense.
 *
 * Distinct from the consumer member portal (mobile-first) and the backoffice
 * (gray/red staff console): this is a customer-facing partner workspace, so it
 * carries the brand (green + navy) with a persistent organization switcher.
 *
 * Gated behind the same organization_coordinator/super_admin backoffice roles
 * that `assertOrganizationCoordinator()` enforces server-side for every
 * /api/v1/organization/* route — mirrors (admin)/layout.tsx's ADMIN_ROLES guard.
 */
const ENTERPRISE_ROLES = ['organization_coordinator', 'super_admin'] as const;
type EnterpriseRole = (typeof ENTERPRISE_ROLES)[number];

// `soon` items show the planned IA without dead links — they render disabled
// with a "Soon" pill until their screen ships (PortalSidebar honours the flag).
const NAV: PortalNavSection[] = [
  {
    title: 'Overview',
    items: [
      { href: '/enterprise', label: 'Portfolio', icon: LayoutDashboard },
      { href: '/enterprise/branches', label: 'Branches', icon: Network },
      // Moved here from the GROUP portal's sidebar, where it sat behind an
      // "Ecosystem" section for organization_coordinator. A funder's view of
      // their own wallet, programs and disbursements belongs with the rest of
      // the organization surface, not inside a group's books.
      { href: '/enterprise/funding', label: 'Funding Portal', icon: Building2 },
      { href: '/enterprise/reports', label: 'Reports', icon: FileBarChart },
    ],
  },
  {
    title: 'Operations',
    items: [
      { href: '/enterprise/members', label: 'Members', icon: Users2 },
      { href: '/enterprise/disbursements', label: 'Disbursements', icon: Banknote },
    ],
  },
  {
    title: 'Developer & Brand',
    items: [
      { href: '/enterprise/api-keys', label: 'API & Webhooks', icon: KeyRound },
      { href: '/enterprise/branding', label: 'White-label', icon: Palette },
      { href: '/enterprise/audit', label: 'Audit Trail', icon: ScrollText },
    ],
  },
];

export default function EnterpriseLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const { user, audience, isLoading } = useAuth();

  React.useEffect(() => {
    if (isLoading) return;
    if (!user || audience !== 'backoffice') {
      router.replace('/enterprise/login');
      return;
    }
    if (!ENTERPRISE_ROLES.includes(user.platformRole as EnterpriseRole)) {
      // Genuinely authenticated-but-denied (e.g. a support-role backoffice
      // user without enterprise access) — /unauthorized, not back to the
      // login page they just came from.
      router.replace('/unauthorized');
    }
  }, [user, audience, isLoading, router]);

  const ready = !isLoading
    && !!user
    && audience === 'backoffice'
    && ENTERPRISE_ROLES.includes(user.platformRole as EnterpriseRole);

  const isActive = (href: string) =>
    href === '/enterprise' ? pathname === href : pathname.startsWith(href);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          <p className="text-sm text-muted-foreground">Verifying enterprise access…</p>
        </div>
      </div>
    );
  }

  // `ready` already proved user is non-null; narrowing again keeps TS happy
  // below without a non-null assertion.
  const initials = `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase() || '?';

  return (
    <div className="flex h-screen overflow-hidden bg-muted/30">
      {/* UX_UI_OPTIMIZATION_AUDIT_2026-08.md H4 — this portal used to hand-roll
          its own drawer/backdrop. It now shares PortalSidebar with (dashboard)
          and (admin), so a11y/focus work lands here too. Side effect worth
          noting: the shared footer gives the enterprise portal a Sign out
          control, which it previously had nowhere at all. */}
      <PortalSidebar
        open={open}
        onClose={() => setOpen(false)}
        variant="brand"
        sections={NAV}
        isActive={isActive}
        widthExpanded="w-[260px]"
        preNav={<div className="border-b p-3"><WorkspaceSwitcher /></div>}
        logo={() => (
          <Link href="/enterprise" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-500 text-sm font-bold text-white">K</span>
            <span className="text-sm font-semibold text-foreground">Kitabu <span className="text-brand-600">Enterprise</span></span>
          </Link>
        )}
      />

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4">
          <button type="button" onClick={() => setOpen(true)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted lg:hidden" aria-label="Open menu">
            <Menu size={18} />
          </button>
          {/* UX_UI_OPTIMIZATION_AUDIT_2026-08.md M4 — the notification bell that
              used to sit here had no handler and a permanently-lit unread dot,
              and this portal has no notifications route to send anyone to. A
              control that always looks like it has news and never does is worse
              than no control, so it is gone until there is something behind it.
              The avatar was hardcoded "EA" for every user; it now shows the
              signed-in user's own initials. */}
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right leading-tight sm:block">
              <p className="text-xs font-medium text-foreground">{user.firstName} {user.lastName}</p>
              <p className="text-[11px] text-muted-foreground">{user.email}</p>
            </div>
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-blue-600 text-xs font-bold text-white"
              title={`${user.firstName} ${user.lastName}`}
            >
              {initials}
            </span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1400px] p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
