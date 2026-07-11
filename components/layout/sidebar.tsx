'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Users, CreditCard, Landmark, BookOpen,
  MessageSquare, BarChart2, Building2, Settings, LogOut, X,
  Receipt, Mail, Heart, TrendingUp, Calendar, Vault, Coins, ReceiptText, Gauge,
  Upload, Smartphone,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth, isTenantUser } from '@/lib/auth/context';
import { authApi } from '@/lib/api/endpoints';
import { BrandLogo } from '@/components/branding/BrandLogo';
const navSections = [
  {
    label: null,
    items: [
      { href: '/dashboard',     label: 'Dashboard',     icon: LayoutDashboard },
      { href: '/contributions', label: 'Contributions',  icon: CreditCard },
      { href: '/loans',         label: 'Loans',          icon: Landmark },
      { href: '/mpesa',         label: 'M-Pesa',         icon: Smartphone },
      { href: '/members',       label: 'Members',        icon: Users },
    ],
  },
  {
    label: 'Money',
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
    label: 'Insights',
    items: [
      { href: '/analytics',     label: 'Analytics',     icon: BarChart2 },
      { href: '/credit-scores', label: 'Credit scores', icon: Gauge },
      { href: '/investments',   label: 'Investments',   icon: TrendingUp },
      { href: '/reports',       label: 'Reports',       icon: BarChart2 },
    ],
  },
  {
    label: 'Engage',
    items: [
      { href: '/meetings',    label: 'Meetings',    icon: Calendar },
      { href: '/sms',         label: 'SMS',         icon: MessageSquare },
      { href: '/whatsapp',    label: 'WhatsApp',    icon: MessageSquare },
      { href: '/email',       label: 'Email',       icon: Mail },
      { href: '/data-import', label: 'Data import', icon: Upload },
    ],
  },
];

const organizationItems = [
  { href: '/organization', label: 'Organization Portal', icon: Building2 },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { user, logout, refreshToken } = useAuth();

  const handleLogout = async () => {
    try { await authApi.logout(refreshToken ?? undefined); } catch {}
    logout();
  };

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={onClose} />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-gray-900 text-white transition-transform duration-300 lg:translate-x-0 lg:static lg:z-auto',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between px-4 h-16 border-b border-gray-700">
          <Link href="/dashboard" className="flex items-center gap-2 min-w-0" aria-label="Kitabu Yetu dashboard">
            {/* Logo on light tile so the PNG's white background reads cleanly against bg-gray-900 */}
            <div className="w-8 h-8 rounded-lg bg-white p-0.5 flex items-center justify-center shrink-0">
              <BrandLogo size={28} alt="Kitabu Yetu" />
            </div>
            <span className="font-bold text-sm truncate">Kitabu Yetu</span>
          </Link>
          <button
            type="button"
            aria-label="Close sidebar"
            onClick={onClose}
            className="lg:hidden text-gray-400 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {isTenantUser(user) && (
          <div className="px-4 py-3 border-b border-gray-700">
            <p className="text-xs text-gray-400 truncate">{user.groupName}</p>
            <p className="text-sm font-medium truncate">{user.firstName} {user.lastName}</p>
            <p className="text-xs text-gray-400 capitalize">{user.groupRole.replace('_', ' ')}</p>
          </div>
        )}

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {navSections.map((section, si) => (
            <div key={si} className={cn(section.label && 'pt-3')}>
              {section.label && (
                <p className="px-3 pb-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  {section.label}
                </p>
              )}
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                      isActive(item.href)
                        ? 'bg-brand-500 text-white'
                        : 'text-gray-300 hover:bg-gray-800 hover:text-white',
                    )}
                  >
                    <Icon size={18} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}

          {user?.platformRole === 'organization_coordinator' && (
            <>
              <div className="pt-4 pb-1 px-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Organization</p>
              </div>
              {organizationItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                      isActive(item.href)
                        ? 'bg-brand-500 text-white'
                        : 'text-gray-300 hover:bg-gray-800 hover:text-white',
                    )}
                  >
                    <Icon size={18} />
                    {item.label}
                  </Link>
                );
              })}
            </>
          )}
        </nav>

        <div className="px-3 py-4 border-t border-gray-700 space-y-1">
          <Link
            href="/settings"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
          >
            <Settings size={18} />
            Settings
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
          >
            <LogOut size={18} />
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
