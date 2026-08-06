'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Building2, Landmark, Users, CreditCard,
  Headphones, ScrollText,
  BarChart3, Flag, ShieldAlert, Activity, MapPin,
  Settings,
} from 'lucide-react';
import { useAuth } from '@/lib/auth/context';
import { BrandLogo } from '@/components/branding/BrandLogo';
import { PortalSidebar, type PortalNavSection } from '@/components/shared/portal-sidebar';

const NAV: PortalNavSection[] = [
  {
    title: 'Core',
    items: [
      { href: '/admin',             label: 'Dashboard',      icon: LayoutDashboard },
      { href: '/admin/organizations', label: 'Organizations',  icon: Landmark },
      { href: '/admin/groups',      label: 'Groups',         icon: Building2 },
      { href: '/admin/users',       label: 'Members',        icon: Users },
      { href: '/admin/billing-admin', label: 'Billing',      icon: CreditCard },
      { href: '/admin/analytics',   label: 'Analytics',      icon: BarChart3 },
      { href: '/admin/geography',   label: 'Geography',      icon: MapPin },
    ],
  },
  {
    title: 'Risk & Compliance',
    items: [
      { href: '/admin/risk',        label: 'Risk & Fraud',   icon: ShieldAlert },
      { href: '/admin/monitoring',  label: 'Monitoring',     icon: Activity },
    ],
  },
  {
    title: 'Operations',
    items: [
      { href: '/admin/support',     label: 'Support Center', icon: Headphones },
      { href: '/admin/audit-logs',  label: 'Audit Logs',     icon: ScrollText },
      { href: '/admin/feature-flags', label: 'Feature Flags', icon: Flag },
    ],
  },
  {
    title: 'System',
    items: [
      { href: '/admin/settings',    label: 'Settings',       icon: Settings },
    ],
  },
];

interface AdminSidebarProps {
  open:    boolean;
  onClose: () => void;
}

export function AdminSidebar({ open, onClose }: AdminSidebarProps) {
  const pathname = usePathname();
  const { user } = useAuth();

  const isActive = (href: string) =>
    href === '/admin' ? pathname === href : pathname.startsWith(href);

  return (
    <PortalSidebar
      open={open}
      onClose={onClose}
      variant="light"
      collapsible
      searchable
      widthExpanded="w-[240px]"
      widthCollapsed="w-[60px]"
      sections={NAV}
      isActive={isActive}
      logo={(collapsed) =>
        collapsed ? (
          <Link href="/admin" aria-label="Kitabu Yetu admin home" title="Kitabu Yetu admin home">
            <BrandLogo size={32} alt="Kitabu Yetu" />
          </Link>
        ) : (
          <Link href="/admin" className="flex items-center gap-2.5 min-w-0" aria-label="Kitabu Yetu admin home">
            <BrandLogo size={28} alt="Kitabu Yetu" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate leading-none">Kitabu Yetu</p>
              <p className="text-[10px] text-brand-blue-500 font-medium tracking-wide mt-0.5">ADMIN CONSOLE</p>
            </div>
          </Link>
        )
      }
      footer={(collapsed) =>
        user && !collapsed ? (
          <div className="px-2 py-1.5 mb-1.5 rounded-md bg-gray-50">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
                <span className="text-[10px] font-bold text-white">
                  {user.firstName?.[0]}{user.lastName?.[0]}
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-gray-900 truncate">
                  {user.firstName} {user.lastName}
                </p>
                <p className="text-[10px] text-blue-600 font-medium capitalize">
                  {user.platformRole?.replace('_', ' ')}
                </p>
              </div>
            </div>
          </div>
        ) : null
      }
    />
  );
}
