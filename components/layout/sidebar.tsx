'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Users, CreditCard, Landmark, BookOpen,
  MessageSquare, BarChart2, Building2, Settings,
  Receipt, Mail, Heart, TrendingUp, Calendar, Vault, Coins, ReceiptText, Gauge,
  Upload, Smartphone, Wallet, MoreHorizontal,
} from 'lucide-react';
import { useAuth, isTenantUser } from '@/lib/auth/context';
import { BrandLogo } from '@/components/branding/BrandLogo';
import { PortalSidebar, type PortalNavSection } from '@/components/shared/portal-sidebar';
import { GroupSwitcher } from './group-switcher';

// "Simple First" primary nav (SIMPLIFICATION_AND_RBAC_AUDIT.md §3): 7 primary
// items max, with Finance and More as collapsible groups (portal-sidebar.tsx's
// `children` primitive) rather than separate titled sections — replaces the
// old 4-section (Money/Insights/Engage) flat-20-item layout.
const NAV: PortalNavSection[] = [
  {
    title: null,
    items: [
      { href: '/dashboard',     label: 'Dashboard',     icon: LayoutDashboard },
      { href: '/members',       label: 'Members',       icon: Users },
      { href: '/contributions', label: 'Contributions', icon: CreditCard },
      { href: '/loans',         label: 'Loans',          icon: Landmark },
      {
        href: '#', label: 'Finance', icon: Wallet,
        children: [
          { href: '/mpesa',      label: 'M-Pesa',     icon: Smartphone },
          { href: '/treasury',   label: 'Treasury',   icon: Vault },
          { href: '/welfare',    label: 'Welfare',    icon: Heart },
          { href: '/shares',     label: 'Shares',     icon: Coins },
          { href: '/dividends',  label: 'Dividends',  icon: ReceiptText },
          { href: '/accounting', label: 'Accounting', icon: BookOpen },
        ],
      },
      { href: '/reports', label: 'Reports', icon: BarChart2 },
      {
        href: '#', label: 'More', icon: MoreHorizontal,
        children: [
          { href: '/meetings',      label: 'Meetings',      icon: Calendar },
          { href: '/sms',           label: 'SMS',           icon: MessageSquare },
          { href: '/whatsapp',      label: 'WhatsApp',      icon: MessageSquare },
          { href: '/email',         label: 'Email',         icon: Mail },
          { href: '/investments',   label: 'Investments',   icon: TrendingUp },
          { href: '/credit-scores', label: 'Credit scores', icon: Gauge },
          { href: '/analytics',     label: 'Analytics',     icon: BarChart2 },
          { href: '/data-import',   label: 'Data import',   icon: Upload },
          { href: '/billing',       label: 'Billing',       icon: Receipt },
          { href: '/settings',      label: 'Settings',      icon: Settings },
        ],
      },
    ],
  },
];

// "Funding Portal" — the Organization funder/monitor's own view (see
// (dashboard)/organization/page.tsx doc comment). Labeled distinctly from
// admin's "Organizations" registry and the unrelated (enterprise) Workspace concept.
const ECOSYSTEM: PortalNavSection = {
  title: 'Ecosystem',
  items: [{ href: '/organization', label: 'Funding Portal', icon: Building2 }],
};

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { user } = useAuth();

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  const sections = user?.platformRole === 'organization_coordinator'
    ? [...NAV, ECOSYSTEM]
    : NAV;

  return (
    <PortalSidebar
      open={open}
      onClose={onClose}
      variant="dark"
      widthExpanded="w-64"
      sections={sections}
      isActive={isActive}
      logo={() => (
        <Link href="/dashboard" className="flex items-center gap-2 min-w-0" aria-label="Kitabu Yetu dashboard">
          {/* Logo on light tile so the PNG's white background reads cleanly against bg-gray-900 */}
          <div className="w-8 h-8 rounded-lg bg-white p-0.5 flex items-center justify-center shrink-0">
            <BrandLogo size={28} alt="Kitabu Yetu" />
          </div>
          <span className="font-bold text-sm truncate">Kitabu Yetu</span>
        </Link>
      )}
      preNav={isTenantUser(user) ? <GroupSwitcher /> : null}
    />
  );
}
