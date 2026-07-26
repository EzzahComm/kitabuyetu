'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  LayoutDashboard, Users, CreditCard, Landmark, BookOpen,
  MessageSquare, BarChart2, Building2, Settings, LogOut,
  Receipt, Mail, Heart, TrendingUp, Calendar, Vault, Coins, ReceiptText, Gauge,
  Upload, Smartphone, Inbox, RefreshCw,
} from 'lucide-react';
import { useAuth } from '@/lib/auth/context';
import { authApi } from '@/lib/api/endpoints';
import { createCommandPalette, type CommandPaletteGroup } from '@/components/shared/command-palette';

/**
 * Global ⌘K / Ctrl-K command palette for the tenant dashboard — a
 * configuration wrapper around the shared shell in
 * components/shared/command-palette.tsx (the same shell components/admin's
 * palette uses). Only the command set, role-conditional entries, and the
 * open-event name are dashboard-specific.
 */
function useDashboardCommandGroups(): CommandPaletteGroup[] {
  const router = useRouter();
  const { user, logout, refreshToken } = useAuth();

  const go = React.useCallback((href: string) => () => router.push(href), [router]);

  return React.useMemo<CommandPaletteGroup[]>(() => {
    const goTo: CommandPaletteGroup = {
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

    const actions: CommandPaletteGroup = {
      heading: 'Actions',
      commands: [
        { id: 'unrouted', label: 'View unrouted M-Pesa payments', hint: 'M-Pesa', icon: Inbox, keywords: 'unmatched pending', run: go('/mpesa/unrouted') },
        { id: 'reconcile', label: 'Run M-Pesa reconciliation', hint: 'M-Pesa', icon: RefreshCw, keywords: 'stk paybill sweep', run: go('/mpesa/reconciliations') },
        {
          id: 'signout', label: 'Sign out', icon: LogOut, keywords: 'logout exit',
          run: async () => { try { await authApi.logout(refreshToken ?? undefined); } catch {} logout(); },
        },
      ],
    };

    return [goTo, actions];
  }, [go, logout, refreshToken, user?.platformRole]);
}

export const { CommandPalette, openCommandPalette } = createCommandPalette(
  'open-dashboard-command-palette',
  useDashboardCommandGroups,
);
