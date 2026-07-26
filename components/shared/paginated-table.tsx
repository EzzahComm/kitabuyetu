'use client';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ChevronLeft, ChevronRight, Inbox, type LucideIcon } from 'lucide-react';

interface PaginatedTableProps<T> {
  data?:         { items: T[]; total: number; page: number; pageSize: number; totalPages: number } | null;
  isLoading:     boolean;
  // header is React.ReactNode so callers can pass a JSX element (e.g. a
  // "select all" checkbox in a selection column) — runtime already supports it.
  columns:       { key: string; header: React.ReactNode; render?: (row: T) => React.ReactNode; className?: string }[];
  onPageChange:  (page: number) => void;
  emptyMessage?: string;
  /** Icon for the empty state; defaults to an inbox. */
  emptyIcon?:    LucideIcon;
  /** Supporting line under the empty title. */
  emptyDescription?: string;
  /** Makes rows clickable (pointer cursor) — e.g. navigate to a detail page. */
  onRowClick?:   (row: T) => void;
}

/** Wraps an unpaginated list in PaginatedTable's data shape (single page, pager hidden). */
export function singlePage<T>(items: T[] | undefined | null): { items: T[]; total: number; page: number; pageSize: number; totalPages: number } {
  const list = items ?? [];
  return { items: list, total: list.length, page: 1, pageSize: Math.max(1, list.length), totalPages: 1 };
}

export function PaginatedTable<T extends { id: string }>({
  data, isLoading, columns, onPageChange, emptyMessage = 'No data found', emptyIcon, emptyDescription, onRowClick,
}: PaginatedTableProps<T>) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              {columns.map((col) => (
                <th key={col.key} className={`px-4 py-3 text-left font-medium text-muted-foreground ${col.className ?? ''}`}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-2">
                  <EmptyState icon={emptyIcon ?? Inbox} title={emptyMessage} description={emptyDescription} size="sm" />
                </td>
              </tr>
            ) : (
              items.map((row) => (
                <tr
                  key={row.id}
                  className={`border-t hover:bg-muted/30 transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={`px-4 py-3 ${col.className ?? ''}`}>
                      {col.render ? col.render(row) : String((row as unknown as Record<string, unknown>)[col.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Showing {((data.page - 1) * data.pageSize) + 1}–{Math.min(data.page * data.pageSize, data.total)} of {data.total}
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline" size="icon"
              aria-label="Previous page"
              disabled={data.page <= 1}
              onClick={() => onPageChange(data.page - 1)}
            >
              <ChevronLeft size={14} />
            </Button>
            <Button
              variant="outline" size="icon"
              aria-label="Next page"
              disabled={data.page >= data.totalPages}
              onClick={() => onPageChange(data.page + 1)}
            >
              <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
