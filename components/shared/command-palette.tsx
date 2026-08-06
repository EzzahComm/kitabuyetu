'use client';

import * as React from 'react';
import { Search, CornerDownLeft, ArrowRight } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export interface CommandPaletteCommand {
  id: string;
  label: string;
  hint?: string;
  icon: React.ElementType;
  keywords?: string;
  run: () => void;
}

export interface CommandPaletteGroup {
  heading: string;
  commands: CommandPaletteCommand[];
}

/**
 * Builds a portal-specific ⌘K command palette instance — the keyboard-nav/
 * filter/scroll-into-view Dialog shell shared by the admin and dashboard
 * palettes, parameterized only by the command set (via `useGroups`, a hook
 * so each portal can pull its own router/auth context) and the window event
 * name used to open it. Event names are kept distinct per portal so one
 * portal's topbar search box never cross-triggers the other's palette.
 *
 * Every command here closes the palette before running — callers don't need
 * to manage that themselves.
 */
export function createCommandPalette(
  openEventName: string,
  useGroups: (query: string) => CommandPaletteGroup[],
) {
  function CommandPalette() {
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState('');
    const groups = useGroups(query);
    const [active, setActive] = React.useState(0);
    const listRef = React.useRef<HTMLDivElement>(null);

    // Single entry point for open/close so we can reset query + selection on
    // the open transition — avoids a setState-in-effect (cascading render).
    const setPaletteOpen = React.useCallback((next: boolean) => {
      if (next) { setQuery(''); setActive(0); }
      setOpen(next);
    }, []);

    const runCommand = React.useCallback((cmd: CommandPaletteCommand) => {
      setPaletteOpen(false);
      cmd.run();
    }, [setPaletteOpen]);

    // Flatten for keyboard selection, respecting the query filter.
    const filtered = React.useMemo(() => {
      const q = query.trim().toLowerCase();
      return groups
        .map((g) => ({
          ...g,
          commands: q
            ? g.commands.filter((c) => (c.label + ' ' + (c.keywords ?? '') + ' ' + (c.hint ?? '')).toLowerCase().includes(q))
            : g.commands,
        }))
        .filter((g) => g.commands.length > 0);
    }, [groups, query]);

    const flat = React.useMemo(() => filtered.flatMap((g) => g.commands), [filtered]);

    // Derive (don't store) the clamped selection so a shrinking list can
    // never point past the end — no clamp effect needed.
    const activeIndex = flat.length ? Math.min(active, flat.length - 1) : 0;

    // Global shortcut + external open event. Re-binds when `open` changes so
    // the ⌘K toggle always reads the current state — no ref needed.
    React.useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
          e.preventDefault();
          setPaletteOpen(!open);
        }
      };
      const onOpen = () => setPaletteOpen(true);
      window.addEventListener('keydown', onKey);
      window.addEventListener(openEventName, onOpen);
      return () => {
        window.removeEventListener('keydown', onKey);
        window.removeEventListener(openEventName, onOpen);
      };
    }, [open, setPaletteOpen]);

    const onListKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(activeIndex + 1, flat.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(activeIndex - 1, 0)); }
      else if (e.key === 'Enter') { e.preventDefault(); const cmd = flat[activeIndex]; if (cmd) runCommand(cmd); }
    };

    // Keep the active row scrolled into view (DOM sync — no setState).
    React.useEffect(() => {
      listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex]);

    let runningIndex = -1;

    return (
      <Dialog open={open} onOpenChange={setPaletteOpen}>
        <DialogContent className="top-[15%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0">
          <DialogTitle className="sr-only">Command palette</DialogTitle>

          <div className="flex items-center gap-2 border-b px-3" onKeyDown={onListKeyDown}>
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search or jump to…"
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              aria-label="Command palette search"
            />
            <kbd className="hidden select-none rounded border bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground sm:inline">ESC</kbd>
          </div>

          <div ref={listRef} className="max-h-[min(60vh,420px)] overflow-y-auto p-2" onKeyDown={onListKeyDown}>
            {flat.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">No results for “{query}”.</p>
            ) : (
              filtered.map((group) => (
                <div key={group.heading} className="mb-1">
                  <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.heading}
                  </p>
                  {group.commands.map((cmd) => {
                    runningIndex += 1;
                    const index = runningIndex;
                    const Icon = cmd.icon;
                    const isActive = index === activeIndex;
                    return (
                      <button
                        key={cmd.id}
                        type="button"
                        data-index={index}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => runCommand(cmd)}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                          isActive ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-muted',
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="flex-1 truncate">{cmd.label}</span>
                        {cmd.hint && <span className="text-xs text-muted-foreground">{cmd.hint}</span>}
                        {isActive
                          ? <CornerDownLeft className="h-3.5 w-3.5 text-muted-foreground" />
                          : <ArrowRight className="h-3.5 w-3.5 text-transparent" />}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          <div className="flex items-center gap-3 border-t px-3 py-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><kbd className="rounded border bg-muted px-1 font-mono">↑↓</kbd> navigate</span>
            <span className="flex items-center gap-1"><kbd className="rounded border bg-muted px-1 font-mono">↵</kbd> open</span>
            <span className="ml-auto flex items-center gap-1"><kbd className="rounded border bg-muted px-1 font-mono">⌘K</kbd> toggle</span>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  function openCommandPalette() {
    window.dispatchEvent(new Event(openEventName));
  }

  return { CommandPalette, openCommandPalette };
}
