'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, BookOpen, Target, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Tab { href: string; label: string; icon: LucideIcon }

const TABS: Tab[] = [
  { href: '/me',          label: 'Home',     icon: Home },
  { href: '/me/passbook', label: 'Passbook', icon: BookOpen },
  { href: '/me/goals',    label: 'Goals',    icon: Target },
];

/**
 * Fixed bottom tab bar — the primary mobile navigation. Large tap targets,
 * always reachable by thumb, with safe-area inset padding for notched phones.
 * Hidden on lg+ where the content centres in a phone-width column.
 */
export function MemberBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Primary"
    >
      <div className="mx-auto flex max-w-md items-stretch justify-around">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = t.href === '/me' ? pathname === '/me' : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors',
                active ? 'text-brand-600' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon size={22} className={cn(active && 'fill-brand-50')} />
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
