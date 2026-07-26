'use client';

import { Menu, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useAuth } from '@/lib/auth/context';
import { openCommandPalette } from '@/components/layout/command-palette';
import { SearchTrigger } from '@/components/shared/search-trigger';

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
      <SearchTrigger
        variant="dashboard"
        onOpen={openCommandPalette}
        placeholder="Search or jump to…"
      />

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
