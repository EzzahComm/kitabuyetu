'use client';

import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The ⌘K command-palette trigger shared by the admin and dashboard topbars —
 * the one genuinely identical block between them (the rest of each topbar
 * intentionally differs). Variant classes are verbatim from the originals:
 * admin uses hardcoded gray palette classes, dashboard uses theme tokens.
 */
const V = {
  admin: {
    btn:  'group relative flex w-full items-center h-8 pl-8 pr-2 text-sm bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors',
    icon: 'absolute left-3 top-1/2 -translate-y-1/2 text-gray-400',
    text: 'text-gray-400 truncate',
    kbd:  'ml-auto hidden sm:inline-flex h-4 select-none items-center gap-0.5 rounded border border-gray-200 bg-white px-1 text-[10px] font-mono text-gray-400',
  },
  dashboard: {
    btn:  'group relative flex h-9 w-full items-center rounded-lg border bg-muted/40 pl-8 pr-2 text-sm hover:bg-muted transition-colors',
    icon: 'absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground',
    text: 'truncate text-muted-foreground',
    kbd:  'ml-auto hidden h-4 select-none items-center gap-0.5 rounded border bg-background px-1 font-mono text-[10px] text-muted-foreground sm:inline-flex',
  },
} as const;

interface SearchTriggerProps {
  onOpen:      () => void;
  placeholder: string;
  variant:     keyof typeof V;
  className?:  string;
}

export function SearchTrigger({ onOpen, placeholder, variant, className }: SearchTriggerProps) {
  const v = V[variant];
  return (
    <div className={cn('max-w-md flex-1', className)}>
      <button type="button" onClick={onOpen} className={v.btn}>
        <Search size={14} className={v.icon} />
        <span className={v.text}>{placeholder}</span>
        <kbd className={v.kbd}>⌘K</kbd>
      </button>
    </div>
  );
}
