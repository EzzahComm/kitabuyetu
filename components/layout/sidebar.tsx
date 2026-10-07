'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BookOpen,
  Building,
  Calendar,
  BarChart3,
  ScatterChart,
  ClipboardList,
  Coins,
  Contact,
  CreditCard,
  Ellipsis,
  Gauge,
  GitCommitVertical,
  Heart,
  Landmark,
  LayoutDashboard,
  Mail,
  Megaphone,
  MessageSquare,
  Receipt,
  Settings,
  Smartphone,
  TrendingUp,
  Upload,
  Users,
  Vault,
  Wallet,
  Zap,
  HandCoins,
} from 'lucide-react';
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
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/members', label: 'Members', icon: Users },
      { href: '/contributions', label: 'Contributions', icon: CreditCard },
      { href: '/loans', label: 'Loans', icon: Landmark },
      {
        href: '#',
        label: 'Finance',
        icon: Wallet,
        children: [
          // M-Pesa and Treasury both read from the mpesa.view-gated
          // transactions/balance endpoints — member/secretary roles never
          // hold that permission (verified against roles.permissions), so
          // the link is disabled rather than leading to a 403 on arrival.
          { href: '/mpesa', label: 'M-Pesa', icon: Smartphone, requires: 'mpesa.view' },
          { href: '/treasury', label: 'Treasury', icon: Vault, requires: 'mpesa.view' },
          { href: '/payouts', label: 'Disbursements', icon: HandCoins, requires: 'member_payouts.manage' },
          { href: '/welfare', label: 'Welfare', icon: Heart },
          { href: '/shares', label: 'Shares', icon: Coins },
          { href: '/dividends', label: 'Dividends', icon: Receipt },
          { href: '/accounting', label: 'Accounting', icon: BookOpen, requires: 'accounting.manage' },
        ],
      },
      { href: '/reports', label: 'Reports', icon: BarChart3 },
      {
        href: '#',
        label: 'Engage',
        icon: Megaphone,
        children: [
          { href: '/meetings', label: 'Meetings', icon: Calendar },
          // Recruitment/membership programs an organization runs (migration
          // 206) — distinct from the public /ecosystem/programs campaign
          // pages and from the org-side Funding Portal's own "programs"
          // (funding_programs, a budget concept).
          { href: '/programs', label: 'Programs', icon: ClipboardList },
          { href: '/crm', label: 'Contacts', icon: Contact },
          { href: '/crm/pipeline', label: 'Pipeline', icon: GitCommitVertical },
          { href: '/marketing', label: 'Marketing', icon: Megaphone },
          { href: '/marketing/automation', label: 'Automation', icon: Zap },
          { href: '/marketing/analytics', label: 'Marketing analytics', icon: ScatterChart },
          { href: '/sms', label: 'SMS', icon: MessageSquare },
          { href: '/whatsapp', label: 'WhatsApp', icon: MessageSquare },
          { href: '/email', label: 'Email', icon: Mail },
        ],
      },
      {
        href: '#',
        label: 'Advanced',
        icon: Gauge,
        children: [
          { href: '/investments', label: 'Investments', icon: TrendingUp, requires: 'investments.view' },
          { href: '/credit-scores', label: 'Credit scores', icon: Gauge },
          { href: '/analytics', label: 'Analytics', icon: BarChart3 },
          { href: '/data-import', label: 'Data import', icon: Upload },
        ],
      },
      {
        href: '#',
        label: 'Settings',
        icon: Settings,
        children: [
          { href: '/billing', label: 'Billing', icon: Receipt },
          { href: '/settings', label: 'Settings', icon: Settings },
          { href: '/settings/organization', label: 'Organization', icon: Building },
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
    'member_payouts.manage': useHasPermission('member_payouts.manage'),
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
