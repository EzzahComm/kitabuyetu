'use client';

import * as React from 'react';
import { BookOpen, Inbox } from 'lucide-react';
import { PassbookRow } from '@/components/member/passbook-row';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ListSkeleton } from '@/components/shared/skeletons';
import { useMyPassbook } from '@/hooks/use-member';
import { cn, getErrorMessage } from '@/lib/utils';
import type { PassbookEntry } from '@/lib/services/member-passbook.service';

type Filter = 'all' | 'in' | 'out';

/** Relative day label for grouping (Today / Yesterday / weekday + date). */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

const PAGE_SIZE = 20;

export default function PassbookPage() {
  const [filter, setFilter] = React.useState<Filter>('all');
  const [limit, setLimit]   = React.useState(PAGE_SIZE);

  const direction = filter === 'all' ? undefined : filter;
  // page stays 1, limit grows on "Load more" — a single query naturally
  // returns the growing prefix (offset 0), no client-side merge/accumulation
  // state needed.
  const { data, isLoading, isError, error, isFetching } = useMyPassbook({ page: 1, limit, direction });

  const changeFilter = (f: Filter) => { setFilter(f); setLimit(PAGE_SIZE); };

  const chips: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'in', label: 'Money in' },
    { key: 'out', label: 'Money out' },
  ];

  const items = data?.items ?? [];

  // Group by day, preserving the source order (already newest-first).
  const groups: { label: string; items: PassbookEntry[] }[] = [];
  for (const e of items) {
    const label = dayLabel(e.date);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(e);
    else groups.push({ label, items: [e] });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-foreground">
            <BookOpen size={20} className="text-brand-600" /> Passbook
          </h1>
          <p className="text-xs text-muted-foreground">Your complete transaction history</p>
        </div>
      </div>

      <div className="flex gap-2">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => changeFilter(c.key)}
            className={cn(
              'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
              filter === c.key ? 'bg-brand-600 text-white' : 'bg-muted text-muted-foreground hover:bg-muted/70',
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <ListSkeleton rows={5} />
      ) : isError ? (
        <EmptyState icon={Inbox} title="Could not load your passbook" description={getErrorMessage(error)} />
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Inbox}
              title="Nothing here yet"
              description="When you contribute, repay a loan, or receive a payout, it will show up in your passbook."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {groups.map((g) => (
            <section key={g.label} className="space-y-1">
              <p className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</p>
              <Card>
                <CardContent className="divide-y px-4 py-0">
                  {g.items.map((e) => <PassbookRow key={e.id} entry={e} />)}
                </CardContent>
              </Card>
            </section>
          ))}
          {data && items.length < data.total && (
            <Button
              variant="outline"
              className="w-full"
              disabled={isFetching}
              onClick={() => setLimit((l) => l + PAGE_SIZE)}
            >
              {isFetching ? 'Loading…' : 'Load more'}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
