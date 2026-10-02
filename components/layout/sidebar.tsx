'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  IconLayoutDashboard,
  IconUsers,
  IconCreditCard,
  IconBuildingBank,
  IconBook,
  IconMessage,
  IconChartBar,
  IconSettings,
  IconReceipt,
  IconMail,
  IconHeart,
  IconTrendingUp,
  IconCalendar,
  IconVault,
  IconCoins,
  IconGauge,
  IconUpload,
  IconDeviceMobile,
  IconWallet,
  IconDots,
  IconAddressBook,
  IconSpeakerphone,
  IconBolt,
  IconTimeline,
  IconChartDots,
  IconBuilding,
} from '@tabler/icons-react';
import { useAuth, isTenantUser } from '@/lib/auth/context';
import { useHasPermission } from '@/lib/auth/use-permission';
import { BrandLockup } from '@/components/branding/BrandLockup';
import { PortalSidebar, type PortalNavItem, type PortalNavSection } from '@/components/shared/portal-sidebar';
import { GroupSwitcher } from './group-switcher';

/** Local-only field: a nav item with `requires` is rendered disabled (same
 *  treatment as `soon`, minus the badge) for anyone lacking that permission —
 *  it never reaches PortalSidebar, which has no permission concept. */
type ConfigNavItem = Omit<PortalNavItem, 'children'> & {
  requires?: string;
  children?: ConfigNavItem[];
};
interface ConfigNavSection {
  title: string | null;
  items: ConfigNavItem[];
}

// Navigation reorganized by user intent (SIMPLIFICATION_AND_RBAC_AUDIT.md §5.1):
// - 7 primary items max
// - Finance (6 core items) + Engage (outreach/community) + Advanced (power users)
//   + Settings (config) as collapsible groups
// - Replaces the old 4-section (Money/Insights/Engage) flat-20-item layout, and the
//   cluttered 15-item "More" menu that forced scrolling
const NAV: ConfigNavSection[] = [
  {
    title: null,
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: IconLayoutDashboard },
      { href: '/members', label: 'Members', icon: IconUsers },
      { href: '/contributions', label: 'Contributions', icon: IconCreditCard },
      { href: '/loans', label: 'Loans', icon: IconBuildingBank },
      {
        href: '#',
        label: 'Finance',
        icon: IconWallet,
        children: [
          // M-Pesa and Treasury both read from the mpesa.view-gated
          // transactions/balance endpoints — member/secretary roles never
          // hold that permission (verified against roles.permissions), so
          // the link is disabled rather than leading to a 403 on arrival.
          { href: '/mpesa', label: 'M-Pesa', icon: IconDeviceMobile, requires: 'mpesa.view' },
          { href: '/treasury', label: 'Treasury', icon: IconVault, requires: 'mpesa.view' },
          { href: '/welfare', label: 'Welfare', icon: IconHeart },
          { href: '/shares', label: 'Shares', icon: IconCoins },
          { href: '/dividends', label: 'Dividends', icon: IconReceipt },
          { href: '/accounting', label: 'Accounting', icon: IconBook, requires: 'accounting.manage' },
        ],
      },
      { href: '/reports', label: 'Reports', icon: IconChartBar },
      {
        href: '#',
        label: 'Engage',
        icon: IconSpeakerphone,
        children: [
          { href: '/meetings', label: 'Meetings', icon: IconCalendar },
          { href: '/crm', label: 'Contacts', icon: IconAddressBook },
          { href: '/crm/pipeline', label: 'Pipeline', icon: IconTimeline },
          { href: '/marketing', label: 'Marketing', icon: IconSpeakerphone },
          { href: '/marketing/automation', label: 'Automation', icon: IconBolt },
          { href: '/marketing/analytics', label: 'Marketing analytics', icon: IconChartDots },
          { href: '/sms', label: 'SMS', icon: IconMessage },
          { href: '/whatsapp', label: 'WhatsApp', icon: IconMessage },
          { href: '/email', label: 'Email', icon: IconMail },
        ],
      },
      {
        href: '#',
        label: 'Advanced',
        icon: IconGauge,
        children: [
          { href: '/investments', label: 'Investments', icon: IconTrendingUp, requires: 'investments.view' },
          { href: '/credit-scores', label: 'Credit scores', icon: IconGauge },
          { href: '/analytics', label: 'Analytics', icon: IconChartBar },
          { href: '/data-import', label: 'Data import', icon: IconUpload },
        ],
      },
      {
        href: '#',
        label: 'Settings',
        icon: IconSettings,
        children: [
          { href: '/billing', label: 'Billing', icon: IconReceipt },
          { href: '/settings', label: 'Settings', icon: IconSettings },
          { href: '/settings/organization', label: 'Organization', icon: IconBuilding },
        ],
      },
    ],
  },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

// Every `requires` value used in NAV above needs its own hook call (rules of
// hooks forbid calling useHasPermission in a loop), resolved into this map.
function usePermissionMap(): Record<string, boolean> {
  return {
    'mpesa.view': useHasPermission('mpesa.view'),
    'accounting.manage': useHasPermission('accounting.manage'),
    'investments.view': useHasPermission('investments.view'),
  };
}

function resolveNav(sections: ConfigNavSection[], granted: Record<string, boolean>): PortalNavSection[] {
  const resolveItem = (item: ConfigNavItem): PortalNavItem => ({
    ...item,
    disabled: item.disabled || (item.requires ? !granted[item.requires] : false),
    children: item.children?.map(resolveItem),
  });
  return sections.map((s) => ({ ...s, items: s.items.map(resolveItem) }));
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { user } = useAuth();
  const granted = usePermissionMap();

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  // The Funding Portal used to be appended here as an "Ecosystem" section for
  // organization_coordinator. It has moved to the Organizations (enterprise)
  // portal at /enterprise/funding, where the rest of the organization surface
  // lives — this is the GROUP portal, and a funder's view of their programs
  // was never a group-scoped screen.
  const sections = resolveNav(NAV, granted);

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
          <BrandLockup size={28} tone="dark" />
        </Link>
      )}
      preNav={isTenantUser(user) ? <GroupSwitcher /> : null}
    />
  );
}
