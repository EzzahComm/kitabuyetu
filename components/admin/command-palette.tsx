'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  LayoutDashboard, Building2, Users, CreditCard, BarChart3, Headphones,
  ScrollText, Flag, ShieldAlert, Settings, LogOut, Activity,
} from 'lucide-react';
import { useAuth } from '@/lib/auth/context';
import { authApi } from '@/lib/api/endpoints';
import { createCommandPalette, type CommandPaletteGroup } from '@/components/shared/command-palette';

/**
 * Global ⌘K / Ctrl-K command palette for the backoffice — a configuration
 * wrapper around the shared shell in components/shared/command-palette.tsx.
 * Only the command set and the open-event name are backoffice-specific; the
 * Dialog/keyboard-nav/filter mechanics live in the shared shell.
 */
function useAdminCommandGroups(): CommandPaletteGroup[] {
  const router = useRouter();
  const { logout, refreshToken } = useAuth();

  const go = React.useCallback((href: string) => () => router.push(href), [router]);

  return React.useMemo<CommandPaletteGroup[]>(() => [
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
}

export const { CommandPalette, openCommandPalette } = createCommandPalette(
  'open-command-palette',
  useAdminCommandGroups,
);
