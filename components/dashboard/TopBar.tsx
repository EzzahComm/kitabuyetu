"use client";

import { IconMenu, IconBell, IconUserCircle } from "@tabler/icons-react";
import { ThemeToggle } from "@/components/ThemeToggle";

interface TopBarProps {
  onMenuClick: () => void;
}

/**
 * Top bar component
 * Shows menu button, notifications, theme toggle, and user menu
 */
export function TopBar({ onMenuClick }: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 dark:border-slate-700 dark:bg-slate-800 sm:px-6 lg:px-8">
      {/* Left: Menu button (mobile only) */}
      <button
        onClick={onMenuClick}
        className="min-h-11 min-w-11 rounded-md p-2 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:bg-gray-700"
        aria-label="Toggle sidebar"
      >
        <IconMenu size={24} className="text-gray-600 dark:text-gray-400" />
      </button>

      {/* Center: Spacer */}
      <div className="flex-1" />

      {/* Right: Actions */}
      <div className="flex items-center gap-4">
        {/* Notifications */}
        <button
          className="relative min-h-11 min-w-11 rounded-md p-2 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:bg-gray-700"
          aria-label="Notifications"
        >
          <IconBell size={24} className="text-gray-600 dark:text-gray-400" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
        </button>

        {/* Theme Toggle */}
        <ThemeToggle />

        {/* User Menu */}
        <button
          className="min-h-11 min-w-11 rounded-md p-2 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:bg-gray-700"
          aria-label="User menu"
        >
          <IconUserCircle size={24} className="text-gray-600 dark:text-gray-400" />
        </button>
      </div>
    </header>
  );
}
