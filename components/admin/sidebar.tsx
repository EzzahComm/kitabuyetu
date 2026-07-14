'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Building2, Landmark, Users, CreditCard,
  Headphones, ScrollText,
  BarChart3, Flag, ShieldAlert, Activity,
  Settings,
  ChevronLeft, ChevronRight, Search, LogOut, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth/context';
import { authApi } from '@/lib/api/endpoints';
import { Input } from '@/components/ui/input';
import { BrandLogo } from '@/components/branding/BrandLogo';

type NavItem = {
  href:   string;
  label:  string;
  icon:   React.ElementType;
  badge?: number;
};

type NavSection = {
  title: string;
  items: NavItem[];
};

const NAV: NavSection[] = [
  {
    title: 'Core',
    items: [
      { href: '/admin',             label: 'Dashboard',      icon: LayoutDashboard },
      { href: '/admin/organizations', label: 'Organizations',  icon: Landmark },
      { href: '/admin/groups',      label: 'Groups',         icon: Building2 },
      { href: '/admin/users',       label: 'Members',        icon: Users },
      { href: '/admin/billing-admin', label: 'Billing',      icon: CreditCard },
      { href: '/admin/analytics',   label: 'Analytics',      icon: BarChart3 },
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
  const { user, logout, refreshToken } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [query,     setQuery]     = useState('');

  const handleLogout = async () => {
    try { await authApi.logout(refreshToken ?? undefined); } catch {}
    logout();
  };

  const isActive = (href: string) =>
    href === '/admin' ? pathname === href : pathname.startsWith(href);

  const filtered: NavSection[] = useMemo(() => {
    if (!query) return NAV;
    return NAV.map((s) => ({
      ...s,
      items: s.items.filter((i) => i.label.toLowerCase().includes(query.toLowerCase())),
    })).filter((s) => s.items.length > 0);
  }, [query]);

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={onClose} />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col bg-white border-r border-gray-200 transition-all duration-200 lg:static lg:z-auto',
          collapsed ? 'w-[60px]' : 'w-[240px]',
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        {/* Header */}
        <div className={cn(
          'border-b border-gray-200 shrink-0',
          collapsed
            ? 'flex flex-col items-center gap-1 py-2'
            : 'flex items-center justify-between h-14 px-3',
        )}>
          {!collapsed ? (
            <Link href="/admin" className="flex items-center gap-2.5 min-w-0" aria-label="Kitabu Yetu admin home">
              <BrandLogo size={28} alt="Kitabu Yetu" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate leading-none">Kitabu Yetu</p>
                <p className="text-[10px] text-brand-blue-500 font-medium tracking-wide mt-0.5">ADMIN CONSOLE</p>
              </div>
            </Link>
          ) : (
            <Link href="/admin" aria-label="Kitabu Yetu admin home" title="Kitabu Yetu admin home">
              <BrandLogo size={32} alt="Kitabu Yetu" />
            </Link>
          )}

          <div className={cn('flex items-center gap-1', collapsed && 'mt-0')}>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close sidebar"
              title="Close sidebar"
              className="lg:hidden p-1 rounded text-gray-400 hover:text-gray-600"
            >
              <X size={16} />
            </button>
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="hidden lg:flex p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
            </button>
          </div>
        </div>

        {/* Search */}
        {!collapsed && (
          <div className="px-3 py-2 border-b border-gray-100">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search navigation…"
                className="h-7 pl-7 text-xs bg-gray-50 border-gray-200"
              />
            </div>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
          {filtered.map((section) => (
            <div key={section.title}>
              {!collapsed && (
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest px-2 mb-1">
                  {section.title}
                </p>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon   = item.icon;
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        'flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm font-medium transition-colors group',
                        active
                          ? 'bg-blue-50 text-blue-700'
                          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
                        collapsed && 'justify-center',
                      )}
                    >
                      <Icon size={16} className={cn(active ? 'text-blue-600' : 'text-gray-400 group-hover:text-gray-600')} />
                      {!collapsed && (
                        <span className="flex-1 truncate">{item.label}</span>
                      )}
                      {!collapsed && item.badge != null && item.badge > 0 && (
                        <span className="ml-auto text-[10px] font-semibold bg-red-100 text-red-600 rounded-full px-1.5 py-0.5 leading-none">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* User footer */}
        <div className={cn('px-2 py-3 border-t border-gray-200 shrink-0', collapsed && 'px-1')}>
          {user && !collapsed && (
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
          )}
          <button
            type="button"
            onClick={handleLogout}
            title={collapsed ? 'Sign out' : undefined}
            className={cn(
              'w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm font-medium text-gray-500 hover:bg-red-50 hover:text-red-600 transition-colors',
              collapsed && 'justify-center',
            )}
          >
            <LogOut size={15} />
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
