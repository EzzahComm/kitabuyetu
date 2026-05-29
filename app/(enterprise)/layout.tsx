'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Network, Users2, Banknote, FileBarChart,
  KeyRound, Palette, ScrollText, Menu, X, Bell, type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { OrgSwitcher } from '@/components/enterprise/org-switcher';

/**
 * B2B Enterprise portal shell — corporate, desktop-first, dense.
 *
 * Distinct from the consumer member portal (mobile-first) and the backoffice
 * (gray/red staff console): this is a customer-facing partner workspace, so it
 * carries the brand (green + navy) with a persistent organization switcher.
 *
 * NOTE: gate this group behind enterprise-role auth in production (mirrors the
 * (dashboard) guard). Left open here so the UI is reviewable in isolation.
 */

interface NavItem { href: string; label: string; icon: LucideIcon; soon?: boolean }
interface NavSection { title: string; items: NavItem[] }

// `soon` items show the planned IA without dead links — they render disabled
// with a "Soon" pill until their screen ships.
const NAV: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { href: '/enterprise', label: 'Portfolio', icon: LayoutDashboard },
      { href: '/enterprise/branches', label: 'Branches', icon: Network },
      { href: '/enterprise/reports', label: 'Reports', icon: FileBarChart, soon: true },
    ],
  },
  {
    title: 'Operations',
    items: [
      { href: '/enterprise/members', label: 'Members', icon: Users2, soon: true },
      { href: '/enterprise/disbursements', label: 'Disbursements', icon: Banknote, soon: true },
    ],
  },
  {
    title: 'Developer & Brand',
    items: [
      { href: '/enterprise/api-keys', label: 'API & Webhooks', icon: KeyRound },
      { href: '/enterprise/branding', label: 'White-label', icon: Palette, soon: true },
      { href: '/enterprise/audit', label: 'Audit Trail', icon: ScrollText, soon: true },
    ],
  },
];

export default function EnterpriseLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  const isActive = (href: string) =>
    href === '/enterprise' ? pathname === href : pathname.startsWith(href);

  return (
    <div className="flex h-screen overflow-hidden bg-muted/30">
      {/* Mobile overlay */}
      {open && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col border-r bg-background transition-transform lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center justify-between border-b px-3">
          <Link href="/enterprise" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-500 text-sm font-bold text-white">K</span>
            <span className="text-sm font-semibold text-foreground">Kitabu <span className="text-brand-600">Enterprise</span></span>
          </Link>
          <button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-muted-foreground lg:hidden" aria-label="Close menu">
            <X size={16} />
          </button>
        </div>

        <div className="border-b p-3">
          <OrgSwitcher />
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto p-3">
          {NAV.map((section) => (
            <div key={section.title}>
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{section.title}</p>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  if (item.soon) {
                    return (
                      <span
                        key={item.href}
                        className="flex cursor-default items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-muted-foreground/50"
                        title="Coming soon"
                      >
                        <Icon size={17} className="text-muted-foreground/40" />
                        {item.label}
                        <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Soon</span>
                      </span>
                    );
                  }
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                        active ? 'bg-brand-50 text-brand-700' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      <Icon size={17} className={cn(active ? 'text-brand-600' : 'text-muted-foreground')} />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4">
          <button type="button" onClick={() => setOpen(true)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted lg:hidden" aria-label="Open menu">
            <Menu size={18} />
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" className="relative rounded-md p-2 text-muted-foreground hover:bg-muted" aria-label="Notifications">
              <Bell size={18} />
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-orange-500" />
            </button>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-blue-600 text-xs font-bold text-white">EA</span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1400px] p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
