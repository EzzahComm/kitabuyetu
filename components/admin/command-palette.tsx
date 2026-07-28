'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  LayoutDashboard, Building2, Users, CreditCard, BarChart3, Headphones,
  ScrollText, Flag, ShieldAlert, Settings, LogOut, Activity,
} from 'lucide-react';
import { useAuth } from '@/lib/auth/context';
import { authApi } from '@/lib/api/endpoints';
import { createCommandPalette, type CommandPaletteGroup, type CommandPaletteCommand } from '@/components/shared/command-palette';
import { useAdminSearch } from '@/hooks/use-admin';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

/**
 * Global ⌘K / Ctrl-K command palette for the backoffice — a configuration
 * wrapper around the shared shell in components/shared/command-palette.tsx.
 * Only the command set and the open-event name are backoffice-specific; the
 * Dialog/keyboard-nav/filter mechanics live in the shared shell.
 *
 * The "Go to" static nav was the only thing this palette ever showed — the
 * shell's own query state is now threaded through so a real cross-entity
 * search (SUPER_ADMIN_PLATFORM_AUDIT.md Phase 3) can inject a live "Search
 * results" group on top of it.
 */
function useAdminCommandGroups(query: string): CommandPaletteGroup[] {
  const router = useRouter();
  const { logout, refreshToken } = useAuth();
  const debouncedQuery = useDebouncedValue(query, 250);
  const { data: results } = useAdminSearch(debouncedQuery);

  const go = React.useCallback((href: string) => () => router.push(href), [router]);

  const navGroups = React.useMemo<CommandPaletteGroup[]>(() => [
    {
      heading: 'Go to',
      commands: [
        { id: 'dash', label: 'Dashboard', icon: LayoutDashboard, keywords: 'home overview platform', run: go('/admin') },
        { id: 'orgs', label: 'Organizations', icon: Building2, keywords: 'banks saccos foundations ngo federating', run: go('/admin/organizations') },
        { id: 'groups', label: 'Groups', icon: Building2, keywords: 'tenants chamas savings groups', run: go('/admin/groups') },
        { id: 'members', label: 'Members', icon: Users, keywords: 'users people accounts', run: go('/admin/users') },
        { id: 'billing', label: 'Billing', icon: CreditCard, keywords: 'revenue subscriptions invoices mrr', run: go('/admin/billing-admin') },
        { id: 'analytics', label: 'Analytics', icon: BarChart3, keywords: 'charts reports insights', run: go('/admin/analytics') },
        { id: 'risk', label: 'Risk & Fraud', icon: ShieldAlert, keywords: 'fraud kyc verification compliance heatmap', run: go('/admin/risk') },
        { id: 'monitoring', label: 'Monitoring', icon: Activity, keywords: 'daraja mpesa sms api health transactions feed uptime latency', run: go('/admin/monitoring') },
        { id: 'support', label: 'Support Center', icon: Headphones, keywords: 'tickets help sla', run: go('/admin/support') },
        { id: 'audit', label: 'Audit Logs', icon: ScrollText, keywords: 'activity history changes', run: go('/admin/audit-logs') },
        { id: 'flags', label: 'Feature Flags', icon: Flag, keywords: 'toggles rollout experiments', run: go('/admin/feature-flags') },
        { id: 'settings', label: 'Settings', icon: Settings, keywords: 'preferences config', run: go('/admin/settings') },
      ],
    },
    {
      heading: 'Actions',
      commands: [
        { id: 'sla', label: 'Review SLA-breached tickets', hint: 'Support', icon: Activity, keywords: 'urgent escalation', run: go('/admin/support?filter=sla_breached') },
        { id: 'kyc', label: 'Open KYC verification queue', hint: 'Risk', icon: ShieldAlert, keywords: 'verify identity pending', run: go('/admin/risk#kyc') },
        {
          id: 'signout', label: 'Sign out', icon: LogOut, keywords: 'logout exit',
          run: async () => { try { await authApi.logout(refreshToken ?? undefined); } catch {} logout(); },
        },
      ],
    },
  ], [go, logout, refreshToken]);

  const resultsGroup = React.useMemo<CommandPaletteGroup | null>(() => {
    if (!results || debouncedQuery.trim().length < 2) return null;
    const commands: CommandPaletteCommand[] = [
      ...results.organizations.map((o): CommandPaletteCommand => ({
        id: `org-${o.id}`, label: o.name, hint: 'Organization', icon: Building2,
        keywords: `${o.registration_number ?? ''} ${o.type}`,
        run: go(`/admin/organizations/${o.id}`),
      })),
      ...results.groups.map((g): CommandPaletteCommand => ({
        id: `group-${g.id}`, label: g.name, hint: 'Group', icon: Building2,
        keywords: `${g.group_code ?? ''} ${g.group_type}`,
        run: go(`/admin/groups/${g.id}`),
      })),
      ...results.members.map((m): CommandPaletteCommand => ({
        id: `member-${m.id}`, label: `${m.first_name} ${m.last_name}`,
        hint: m.group_name ? `Member · ${m.group_name}` : 'Member', icon: Users,
        keywords: `${m.phone ?? ''} ${m.member_code ?? ''}`,
        run: m.group_id ? go(`/admin/groups/${m.group_id}/members/${m.id}`) : go('/admin/users'),
      })),
    ];
    return commands.length ? { heading: 'Search results', commands } : null;
  }, [results, debouncedQuery, go]);

  return React.useMemo<CommandPaletteGroup[]>(
    () => (resultsGroup ? [resultsGroup, ...navGroups] : navGroups),
    [resultsGroup, navGroups],
  );
}

export const { CommandPalette, openCommandPalette } = createCommandPalette(
  'open-command-palette',
  useAdminCommandGroups,
);
