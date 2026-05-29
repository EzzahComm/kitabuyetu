'use client';

import * as React from 'react';
import { Building2, Check, ChevronsUpDown, Plus } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { organizations } from '@/app/(enterprise)/_data';

/**
 * Workspace / organization switcher — lets a partner that manages several
 * entities (a federation + its programmes, or a microfinance with regional
 * arms) flip the entire portal's scope. Sits at the top of the sidebar, the
 * conventional place enterprise users look for it.
 *
 * Switching is local/cosmetic here; in production this writes to a Zustand
 * `useWorkspace()` store that scopes every query.
 */
export function OrgSwitcher() {
  const [current, setCurrent] = React.useState(organizations[0]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-lg border bg-card p-2 text-left transition-colors hover:bg-muted"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-blue-600 text-white">
            <Building2 size={16} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-foreground">{current.name}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{current.type} · {current.branches} branches</span>
          </span>
          <ChevronsUpDown size={14} className="shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Organizations</DropdownMenuLabel>
        {organizations.map((org) => (
          <DropdownMenuItem key={org.id} onClick={() => setCurrent(org)} className="gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Building2 size={14} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{org.name}</span>
              <span className="block text-[11px] text-muted-foreground">{org.type}</span>
            </span>
            {org.id === current.id && <Check size={15} className="text-brand-600" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2 text-muted-foreground">
          <span className="flex h-7 w-7 items-center justify-center rounded-md border border-dashed">
            <Plus size={14} />
          </span>
          Add organization
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
