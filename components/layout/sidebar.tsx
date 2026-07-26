'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Users, CreditCard, Landmark, BookOpen,
  MessageSquare, BarChart2, Building2, Settings,
  Receipt, Mail, Heart, TrendingUp, Calendar, Vault, Coins, ReceiptText, Gauge,
  Upload, Smartphone,
} from 'lucide-react';
import { useAuth, isTenantUser } from '@/lib/auth/context';
import { BrandLogo } from '@/components/branding/BrandLogo';
import { PortalSidebar, type PortalNavSection } from '@/components/shared/portal-sidebar';
import { GroupSwitcher } from './group-switcher';

const NAV: PortalNavSection[] = [
  {
    title: null,
    items: [
      { href: '/dashboard',     label: 'Dashboard',     icon: LayoutDashboard },
      { href: '/contributions', label: 'Contributions',  icon: CreditCard },
      { href: '/loans',         label: 'Loans',          icon: Landmark },
      { href: '/mpesa',         label: 'M-Pesa',         icon: Smartphone },
      { href: '/members',       label: 'Members',        icon: Users },
    ],
  },
  {
    title: 'Money',
    items: [
      { href: '/welfare',    label: 'Welfare',    icon: Heart },
      { href: '/shares',     label: 'Shares',     icon: Coins },
      { href: '/dividends',  label: 'Dividends',  icon: ReceiptText },
      { href: '/treasury',   label: 'Treasury',   icon: Vault },
      { href: '/accounting', label: 'Accounting', icon: BookOpen },
      { href: '/billing',    label: 'Billing',    icon: Receipt },
    ],
  },
  {
    title: 'Insights',
    items: [
      { href: '/analytics',     label: 'Analytics',     icon: BarChart2 },
      { href: '/credit-scores', label: 'Credit scores', icon: Gauge },
      { href: '/investments',   label: 'Investments',   icon: TrendingUp },
      { href: '/reports',       label: 'Reports',       icon: BarChart2 },
    ],
  },
  {
    title: 'Engage',
    items: [
      { href: '/meetings',    label: 'Meetings',    icon: Calendar },
      { href: '/sms',         label: 'SMS',         icon: MessageSquare },
      { href: '/whatsapp',    label: 'WhatsApp',    icon: MessageSquare },
      { href: '/email',       label: 'Email',       icon: Mail },
      { href: '/data-import', label: 'Data import', icon: Upload },
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
      footer={() => (
        <Link
          href="/settings"
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
        >
          <Settings size={18} />
          Settings
        </Link>
      )}
    />
  );
}
