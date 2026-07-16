'use client';

import { Menu, Bell, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useAuth } from '@/lib/auth/context';
import { openCommandPalette } from '@/components/layout/command-palette';

interface TopBarProps {
  onMenuClick: () => void;
}

export function TopBar({ onMenuClick }: TopBarProps) {
  const { user } = useAuth();

  const initials = user
    ? `${user.firstName[0]}${user.lastName[0]}`.toUpperCase()
    : '??';

  return (
    <header className="h-16 border-b bg-background flex items-center gap-4 px-4 lg:px-6">
      <button
        onClick={onMenuClick}
        className="lg:hidden p-2 -ml-2 rounded-md text-muted-foreground hover:text-foreground"
      >
        <Menu size={20} />
      </button>

      {/* Global search — opens the ⌘K command palette */}
      <div className="max-w-md flex-1">
        <button
          type="button"
          onClick={openCommandPalette}
          className="group relative flex h-9 w-full items-center rounded-lg border bg-muted/40 pl-8 pr-2 text-sm hover:bg-muted transition-colors"
        >
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <span className="truncate text-muted-foreground">Search or jump to…</span>
          <kbd className="ml-auto hidden h-4 select-none items-center gap-0.5 rounded border bg-background px-1 font-mono text-[10px] text-muted-foreground sm:inline-flex">
            ⌘K
          </kbd>
        </button>
      </div>

      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="relative">
          <Bell size={18} />
        </Button>
        <Avatar className="h-8 w-8">
          <AvatarFallback className="bg-brand-500 text-white text-xs font-semibold">
            {initials}
          </AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}
