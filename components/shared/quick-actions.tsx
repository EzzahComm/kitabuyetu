'use client';

import * as React from 'react';
import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface QuickAction {
  label: string;
  icon: LucideIcon;
  onClick?: () => void;
  href?: string;
  /** Tailwind tint class for the icon chip, e.g. 'bg-brand-50 text-brand-600'. */
  tint?: string;
}

/**
 * Big, thumb-friendly action grid — the WhatsApp-level "what can I do" row.
 * Large tap targets (min 64px), icon + short label, minimal text. Built for
 * low digital-literacy users: every primary task is one tap from home.
 * Originally member-portal-only; moved to components/shared when the
 * officer dashboard adopted the same pattern (SIMPLIFICATION_AND_RBAC_AUDIT.md §4).
 */
export function QuickActions({ actions }: { actions: QuickAction[] }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {actions.map((a) => {
        const Icon = a.icon;
        const Inner = (
          <>
            <span className={cn('flex h-12 w-12 items-center justify-center rounded-2xl', a.tint ?? 'bg-brand-50 text-brand-600')}>
              <Icon size={22} />
            </span>
            <span className="text-[11px] font-medium leading-tight text-foreground">{a.label}</span>
          </>
        );
        const cls = 'flex flex-col items-center gap-1.5 rounded-xl py-2 text-center transition-colors active:bg-muted';
        return a.href ? (
          <a key={a.label} href={a.href} className={cls}>{Inner}</a>
        ) : (
          <button key={a.label} type="button" onClick={a.onClick} className={cls}>{Inner}</button>
        );
      })}
    </div>
  );
}
