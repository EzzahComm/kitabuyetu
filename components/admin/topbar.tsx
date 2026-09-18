'use client';

import { useRouter } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import { useTheme } from 'next-themes';
import {
  Bell, Menu, ChevronDown,
  CircleCheck, CircleAlert, Activity,
  LogOut, Settings, Sun, Moon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth/context';
import { authApi } from '@/lib/api/endpoints';
import { openCommandPalette } from '@/components/admin/command-palette';
import { SearchTrigger } from '@/components/shared/search-trigger';
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
  const { resolvedTheme, setTheme } = useTheme();
  // next-themes can't know the resolved theme until after hydration (it
  // reads localStorage/matchMedia client-side) — rendering the icon before
  // that would mismatch server vs. client markup. useSyncExternalStore's
  // getServerSnapshot/getSnapshot split gives an SSR-safe "have we mounted
  // yet" read without a setState-in-an-effect render round-trip.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const handleLogout = async () => {
    try { await authApi.logout(refreshToken ?? undefined); } catch {}
    logout();
  };

  return (
    <header className="h-14 border-b border-border bg-background flex items-center px-4 gap-4 shrink-0">
      {/* Mobile hamburger */}
      <button
        type="button"
        onClick={onMenuClick}
        className="lg:hidden p-1.5 rounded-md text-muted-foreground hover:bg-accent"
      >
        <Menu size={18} />
      </button>

      {/* Global search — opens the ⌘K command palette */}
      <SearchTrigger
        variant="admin"
        onOpen={openCommandPalette}
        placeholder="Search organizations, users, tickets…"
      />

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

        {/* Theme toggle */}
        <button
          type="button"
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          className="p-1.5 rounded-md text-muted-foreground hover:bg-accent"
          title={mounted && resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {mounted && resolvedTheme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>

        {/* Notifications */}
        <button
          type="button"
          className="relative p-1.5 rounded-md text-muted-foreground hover:bg-accent"
        >
          <Bell size={17} />
          <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-red-500 rounded-full" />
        </button>

        {/* Activity */}
        <button
          type="button"
          onClick={() => router.push('/admin/audit-logs')}
          className="p-1.5 rounded-md text-muted-foreground hover:bg-accent"
          title="Activity logs"
        >
          <Activity size={17} />
        </button>

        {/* Profile dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-accent transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center">
                <span className="text-[11px] font-bold text-white">
                  {user?.firstName?.[0]}{user?.lastName?.[0]}
                </span>
              </div>
              <div className="hidden sm:block text-left">
                <p className="text-xs font-semibold text-foreground leading-none">
                  {user?.firstName} {user?.lastName}
                </p>
                <p className="text-[10px] text-blue-600 font-medium capitalize leading-none mt-0.5">
                  {user?.platformRole?.replace('_', ' ')}
                </p>
              </div>
              <ChevronDown size={13} className="text-muted-foreground hidden sm:block" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="text-xs text-muted-foreground">Signed in as</DropdownMenuLabel>
            <DropdownMenuLabel className="text-sm font-semibold text-foreground pt-0">
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
