'use client';

import { useRouter } from 'next/navigation';
import {
  Bell, Search, Menu, ChevronDown,
  CircleCheck, CircleAlert, Activity,
  LogOut, Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth/context';
import { authApi } from '@/lib/api/endpoints';
import { openCommandPalette } from '@/components/admin/command-palette';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const STATUS = { label: 'All systems operational', ok: true };

interface AdminTopbarProps {
  onMenuClick: () => void;
}

export function AdminTopbar({ onMenuClick }: AdminTopbarProps) {
  const router = useRouter();
  const { user, logout, refreshToken } = useAuth();

  const handleLogout = async () => {
    try { await authApi.logout(refreshToken ?? undefined); } catch {}
    logout();
  };

  return (
    <header className="h-14 border-b border-gray-200 bg-white flex items-center px-4 gap-4 shrink-0">
      {/* Mobile hamburger */}
      <button
        type="button"
        onClick={onMenuClick}
        className="lg:hidden p-1.5 rounded-md text-gray-500 hover:bg-gray-100"
      >
        <Menu size={18} />
      </button>

      {/* Global search — opens the ⌘K command palette */}
      <div className="flex-1 max-w-md">
        <button
          type="button"
          onClick={openCommandPalette}
          className="group relative flex w-full items-center h-8 pl-8 pr-2 text-sm bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <span className="text-gray-400 truncate">Search organizations, users, tickets…</span>
          <kbd className="ml-auto hidden sm:inline-flex h-4 select-none items-center gap-0.5 rounded border border-gray-200 bg-white px-1 text-[10px] font-mono text-gray-400">
            ⌘K
          </kbd>
        </button>
      </div>

      <div className="flex items-center gap-2 ml-auto">
        {/* System status pill */}
        <div className={cn(
          'hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border',
          STATUS.ok
            ? 'bg-green-50 text-green-700 border-green-200'
            : 'bg-red-50 text-red-700 border-red-200',
        )}>
          {STATUS.ok
            ? <CircleCheck size={12} className="text-green-500" />
            : <CircleAlert size={12} className="text-red-500" />
          }
          {STATUS.label}
        </div>

        {/* Notifications */}
        <button
          type="button"
          className="relative p-1.5 rounded-md text-gray-500 hover:bg-gray-100"
        >
          <Bell size={17} />
          <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-red-500 rounded-full" />
        </button>

        {/* Activity */}
        <button
          type="button"
          onClick={() => router.push('/admin/audit-logs')}
          className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100"
          title="Activity logs"
        >
          <Activity size={17} />
        </button>

        {/* Profile dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-gray-100 transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center">
                <span className="text-[11px] font-bold text-white">
                  {user?.firstName?.[0]}{user?.lastName?.[0]}
                </span>
              </div>
              <div className="hidden sm:block text-left">
                <p className="text-xs font-semibold text-gray-900 leading-none">
                  {user?.firstName} {user?.lastName}
                </p>
                <p className="text-[10px] text-blue-600 font-medium capitalize leading-none mt-0.5">
                  {user?.platformRole?.replace('_', ' ')}
                </p>
              </div>
              <ChevronDown size={13} className="text-gray-400 hidden sm:block" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="text-xs text-gray-500">Signed in as</DropdownMenuLabel>
            <DropdownMenuLabel className="text-sm font-semibold text-gray-900 pt-0">
              {user?.firstName} {user?.lastName}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push('/admin/settings')}>
              <Settings size={14} className="mr-2" /> Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-red-600 focus:text-red-600">
              <LogOut size={14} className="mr-2" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
