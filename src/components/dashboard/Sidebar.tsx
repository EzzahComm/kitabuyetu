"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandLogo } from "@/components/BrandLogo";
import {
  IconHome,
  IconUsers,
  IconCoin,
  IconPigMoney,
  IconBriefcase,
  IconFileText,
  IconCalculator,
  IconBell,
  IconSettings,
  IconLogout,
} from "@tabler/icons-react";

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Sidebar navigation component
 * Responsive: full on desktop, drawer on mobile
 */
export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();

  const isActive = (href: string) => pathname.startsWith(href);

  const NavLink = ({
    href,
    icon: Icon,
    label,
  }: {
    href: string;
    icon: React.ComponentType<any>;
    label: string;
  }) => {
    const active = isActive(href);
    return (
      <Link
        href={href}
        onClick={onClose}
        className={`flex items-center gap-3 px-4 py-2.5 rounded-md transition-colors ${
          active
            ? "bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300"
            : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
        }`}
      >
        <Icon size={20} className="flex-shrink-0" />
        <span className="text-sm font-medium">{label}</span>
      </Link>
    );
  };

  return (
    <>
      {/* Sidebar */}
      <div
        aria-label="Dashboard navigation"
        className={`fixed inset-y-0 left-0 z-50 w-72 transform overflow-y-auto border-r border-slate-200 bg-white transition-transform duration-300 dark:border-slate-700 dark:bg-slate-800 lg:static ${
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-6 dark:border-slate-700">
            <BrandLogo size={32} />
            <div className="hidden sm:block">
              <h1 className="text-lg font-bold text-gray-900 dark:text-white">
                Kitabu Yetu
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Bookkeeper
              </p>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-6">
            {/* OVERVIEW */}
            <div>
              <p className="mb-3 px-4 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Overview
              </p>
              <div className="space-y-1">
                <NavLink href="/dashboard" icon={IconHome} label="Dashboard" />
                <NavLink
                  href="/dashboard/notifications"
                  icon={IconBell}
                  label="Notifications"
                />
              </div>
            </div>

            {/* GROUP MANAGEMENT */}
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase px-4 mb-3 mt-6">
                Group Management
              </p>
              <div className="space-y-1">
                <NavLink href="/dashboard/members" icon={IconUsers} label="Members" />
                <NavLink
                  href="/dashboard/contributions"
                  icon={IconCoin}
                  label="Contributions"
                />
                <NavLink href="/dashboard/savings" icon={IconPigMoney} label="Savings" />
                <NavLink
                  href="/dashboard/loans"
                  icon={IconBriefcase}
                  label="Loans"
                />
              </div>
            </div>

            {/* FINANCE */}
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase px-4 mb-3 mt-6">
                Finance
              </p>
              <div className="space-y-1">
                <NavLink
                  href="/dashboard/finance/transactions"
                  icon={IconCalculator}
                  label="Transactions"
                />
                <NavLink
                  href="/dashboard/finance/reports"
                  icon={IconFileText}
                  label="Reports"
                />
              </div>
            </div>

            {/* ADMINISTRATION */}
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase px-4 mb-3 mt-6">
                Administration
              </p>
              <div className="space-y-1">
                <NavLink
                  href="/dashboard/settings"
                  icon={IconSettings}
                  label="Settings"
                />
              </div>
            </div>
          </nav>

          {/* Footer */}
          <div className="border-t border-gray-200 dark:border-gray-700 px-3 py-4 space-y-1">
            <button
              className="w-full flex items-center gap-3 px-4 py-2.5 rounded-md text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm font-medium"
              onClick={() => {
                /* Handle logout */
              }}
            >
              <IconLogout size={20} className="flex-shrink-0" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
