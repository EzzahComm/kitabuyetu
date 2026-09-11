'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  IconLayoutDashboard, IconUsers, IconCreditCard, IconBuildingBank, IconBook,
  IconMessage, IconChartBar, IconSettings,
  IconReceipt, IconMail, IconHeart, IconTrendingUp, IconCalendar, IconVault,
  IconCoins, IconGauge, IconUpload, IconDeviceMobile, IconWallet, IconDots,
} from '@tabler/icons-react';
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
      { href: '/dashboard',     label: 'Dashboard',     icon: IconLayoutDashboard },
      { href: '/members',       label: 'Members',       icon: IconUsers },
      { href: '/contributions', label: 'Contributions', icon: IconCreditCard },
      { href: '/loans',         label: 'Loans',          icon: IconBuildingBank },
      {
        href: '#', label: 'Finance', icon: IconWallet,
        children: [
          { href: '/mpesa',      label: 'M-Pesa',     icon: IconDeviceMobile },
          { href: '/treasury',   label: 'Treasury',   icon: IconVault },
          { href: '/welfare',    label: 'Welfare',    icon: IconHeart },
          { href: '/shares',     label: 'Shares',     icon: IconCoins },
          { href: '/dividends',  label: 'Dividends',  icon: IconReceipt },
          { href: '/accounting', label: 'Accounting', icon: IconBook },
        ],
      },
      { href: '/reports', label: 'Reports', icon: IconChartBar },
      {
        href: '#', label: 'More', icon: IconDots,
        children: [
          { href: '/meetings',      label: 'Meetings',      icon: IconCalendar },
          { href: '/sms',           label: 'SMS',           icon: IconMessage },
          { href: '/whatsapp',      label: 'WhatsApp',      icon: IconMessage },
          { href: '/email',         label: 'Email',         icon: IconMail },
          { href: '/investments',   label: 'Investments',   icon: IconTrendingUp },
          { href: '/credit-scores', label: 'Credit scores', icon: IconGauge },
          { href: '/analytics',     label: 'Analytics',     icon: IconChartBar },
          { href: '/data-import',   label: 'Data import',   icon: IconUpload },
          { href: '/billing',       label: 'Billing',       icon: IconReceipt },
          { href: '/settings',      label: 'Settings',      icon: IconSettings },
        ],
      },
    ],
  },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { user } = useAuth();

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  // The Funding Portal used to be appended here as an "Ecosystem" section for
  // organization_coordinator. It has moved to the Organizations (enterprise)
  // portal at /enterprise/funding, where the rest of the organization surface
  // lives — this is the GROUP portal, and a funder's view of their programs
  // was never a group-scoped screen.
  const sections = NAV;

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
