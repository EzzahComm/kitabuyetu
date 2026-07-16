'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  LayoutDashboard, Users, CreditCard, Landmark, BookOpen,
  MessageSquare, BarChart2, Building2, Settings, Search, CornerDownLeft, LogOut,
  Receipt, Mail, Heart, TrendingUp, Calendar, Vault, Coins, ReceiptText, Gauge,
  Upload, Smartphone, Inbox, RefreshCw, ArrowRight,
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth/context';
import { authApi } from '@/lib/api/endpoints';

/**
 * Global ⌘K / Ctrl-K command palette for the tenant dashboard — the same
 * pattern as `components/admin/command-palette.tsx`, so the platform's
 * highest-traffic portal gets the same fast, keyboard-first navigation the
 * backoffice already has. Kept as a separate component (rather than a shared
 * one parameterized by portal) because the two command sets, role gating, and
 * mount points are independent and rarely change in lockstep.
 *
 * Registers its own global key listener AND listens for a window
 * "open-dashboard-command-palette" event so the topbar search box can open it
 * without prop-drilling. No external dependency (cmdk) — built on the
 * existing Dialog primitive + roving keyboard selection.
 */

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: React.ElementType;
  keywords?: string;
  run: () => void;
}

interface Group {
  heading: string;
  commands: Command[];
}

export function CommandPalette() {
  const router = useRouter();
  const { user, logout, refreshToken } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);
  const listRef = React.useRef<HTMLDivElement>(null);

  // Single entry point for open/close so we can reset query + selection on the
  // open transition — avoids a setState-in-effect (cascading render).
  const setPaletteOpen = React.useCallback((next: boolean) => {
    if (next) { setQuery(''); setActive(0); }
    setOpen(next);
  }, []);

  const go = React.useCallback((href: string) => () => { setPaletteOpen(false); router.push(href); }, [router, setPaletteOpen]);

  const groups = React.useMemo<Group[]>(() => {
    const goTo: Group = {
      heading: 'Go to',
      commands: [
        { id: 'dash', label: 'Dashboard', icon: LayoutDashboard, keywords: 'home overview', run: go('/dashboard') },
        { id: 'contributions', label: 'Contributions', icon: CreditCard, keywords: 'savings deposits', run: go('/contributions') },
        { id: 'loans', label: 'Loans', icon: Landmark, keywords: 'lending disbursement repayment', run: go('/loans') },
        { id: 'mpesa', label: 'M-Pesa', icon: Smartphone, keywords: 'stk paybill b2c transactions', run: go('/mpesa') },
        { id: 'members', label: 'Members', icon: Users, keywords: 'people accounts', run: go('/members') },
        { id: 'welfare', label: 'Welfare', icon: Heart, keywords: 'welfare fund', run: go('/welfare') },
        { id: 'shares', label: 'Shares', icon: Coins, keywords: 'share classes capital', run: go('/shares') },
        { id: 'dividends', label: 'Dividends', icon: ReceiptText, keywords: 'payouts distributions', run: go('/dividends') },
        { id: 'treasury', label: 'Treasury', icon: Vault, keywords: 'cash funds', run: go('/treasury') },
        { id: 'accounting', label: 'Accounting', icon: BookOpen, keywords: 'ledger journal trial balance', run: go('/accounting') },
        { id: 'billing', label: 'Billing', icon: Receipt, keywords: 'plan subscription invoice', run: go('/billing') },
        { id: 'analytics', label: 'Analytics', icon: BarChart2, keywords: 'charts insights', run: go('/analytics') },
        { id: 'credit-scores', label: 'Credit scores', icon: Gauge, keywords: 'risk scoring', run: go('/credit-scores') },
        { id: 'investments', label: 'Investments', icon: TrendingUp, keywords: 'portfolio returns', run: go('/investments') },
        { id: 'reports', label: 'Reports', icon: BarChart2, keywords: 'statements exports', run: go('/reports') },
        { id: 'meetings', label: 'Meetings', icon: Calendar, keywords: 'minutes attendance', run: go('/meetings') },
        { id: 'sms', label: 'SMS', icon: MessageSquare, keywords: 'text messages templates', run: go('/sms') },
        { id: 'whatsapp', label: 'WhatsApp', icon: MessageSquare, keywords: 'messages chat', run: go('/whatsapp') },
        { id: 'email', label: 'Email', icon: Mail, keywords: 'campaigns templates logs', run: go('/email') },
        { id: 'data-import', label: 'Data import', icon: Upload, keywords: 'csv migration bulk upload', run: go('/data-import') },
        { id: 'settings', label: 'Settings', icon: Settings, keywords: 'profile preferences', run: go('/settings') },
      ],
    };

    if (user?.platformRole === 'organization_coordinator') {
      goTo.commands.push({
        id: 'funding-portal', label: 'Funding Portal', icon: Building2,
        keywords: 'organization funder programs disbursements ecosystem', run: go('/organization'),
      });
    }

    const actions: Group = {
      heading: 'Actions',
      commands: [
        { id: 'unrouted', label: 'View unrouted M-Pesa payments', hint: 'M-Pesa', icon: Inbox, keywords: 'unmatched pending', run: go('/mpesa/unrouted') },
        { id: 'reconcile', label: 'Run M-Pesa reconciliation', hint: 'M-Pesa', icon: RefreshCw, keywords: 'stk paybill sweep', run: go('/mpesa/reconciliations') },
        {
          id: 'signout', label: 'Sign out', icon: LogOut, keywords: 'logout exit',
          run: async () => { setPaletteOpen(false); try { await authApi.logout(refreshToken ?? undefined); } catch {} logout(); },
        },
      ],
    };

    return [goTo, actions];
  }, [go, logout, refreshToken, setPaletteOpen, user?.platformRole]);

  // Flatten for keyboard selection, respecting the query filter.
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        commands: q
          ? g.commands.filter((c) => (c.label + ' ' + (c.keywords ?? '') + ' ' + (c.hint ?? '')).toLowerCase().includes(q))
          : g.commands,
      }))
      .filter((g) => g.commands.length > 0);
  }, [groups, query]);

  const flat = React.useMemo(() => filtered.flatMap((g) => g.commands), [filtered]);

  // Derive (don't store) the clamped selection so a shrinking list can never
  // point past the end — no clamp effect needed.
  const activeIndex = flat.length ? Math.min(active, flat.length - 1) : 0;

  // Global shortcut + external open event. Re-binds when `open` changes so the
  // ⌘K toggle always reads the current state — no ref needed.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(!open);
      }
    };
    const onOpen = () => setPaletteOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('open-dashboard-command-palette', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('open-dashboard-command-palette', onOpen);
    };
  }, [open, setPaletteOpen]);

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(activeIndex + 1, flat.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(activeIndex - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); flat[activeIndex]?.run(); }
  };

  // Keep the active row scrolled into view (DOM sync — no setState).
  React.useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  let runningIndex = -1;

  return (
    <Dialog open={open} onOpenChange={setPaletteOpen}>
      <DialogContent className="top-[15%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Command palette</DialogTitle>

        <div className="flex items-center gap-2 border-b px-3" onKeyDown={onListKeyDown}>
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search or jump to…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            aria-label="Command palette search"
          />
          <kbd className="hidden select-none rounded border bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground sm:inline">ESC</kbd>
        </div>

        <div ref={listRef} className="max-h-[min(60vh,420px)] overflow-y-auto p-2" onKeyDown={onListKeyDown}>
          {flat.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">No results for “{query}”.</p>
          ) : (
            filtered.map((group) => (
              <div key={group.heading} className="mb-1">
                <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.heading}
                </p>
                {group.commands.map((cmd) => {
                  runningIndex += 1;
                  const index = runningIndex;
                  const Icon = cmd.icon;
                  const isActive = index === activeIndex;
                  return (
                    <button
                      key={cmd.id}
                      type="button"
                      data-index={index}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => cmd.run()}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                        isActive ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-muted',
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate">{cmd.label}</span>
                      {cmd.hint && <span className="text-xs text-muted-foreground">{cmd.hint}</span>}
                      {isActive
                        ? <CornerDownLeft className="h-3.5 w-3.5 text-muted-foreground" />
                        : <ArrowRight className="h-3.5 w-3.5 text-transparent" />}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 border-t px-3 py-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1"><kbd className="rounded border bg-muted px-1 font-mono">↑↓</kbd> navigate</span>
          <span className="flex items-center gap-1"><kbd className="rounded border bg-muted px-1 font-mono">↵</kbd> open</span>
          <span className="ml-auto flex items-center gap-1"><kbd className="rounded border bg-muted px-1 font-mono">⌘K</kbd> toggle</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Helper for non-React callers (e.g. the topbar search box) to open the palette. */
export function openCommandPalette() {
  window.dispatchEvent(new Event('open-dashboard-command-palette'));
}
