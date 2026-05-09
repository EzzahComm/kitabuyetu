'use client';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginatedTableProps<T> {
  data?:         { items: T[]; total: number; page: number; pageSize: number; totalPages: number } | null;
  isLoading:     boolean;
  columns:       { key: string; header: string; render?: (row: T) => React.ReactNode; className?: string }[];
  onPageChange:  (page: number) => void;
  emptyMessage?: string;
}

export function PaginatedTable<T extends { id: string }>({
  data, isLoading, columns, onPageChange, emptyMessage = 'No data found',
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
      <div className="rounded-md border overflow-hidden">
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
                <td colSpan={columns.length} className="px-4 py-8 text-center text-muted-foreground">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              items.map((row) => (
                <tr key={row.id} className="border-t hover:bg-muted/30 transition-colors">
                  {columns.map((col) => (
                    <td key={col.key} className={`px-4 py-3 ${col.className ?? ''}`}>
                      {col.render ? col.render(row) : String((row as any)[col.key] ?? '')}
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
              variant="outline" size="icon" className="h-8 w-8"
              disabled={data.page <= 1}
              onClick={() => onPageChange(data.page - 1)}
            >
              <ChevronLeft size={14} />
            </Button>
            <Button
              variant="outline" size="icon" className="h-8 w-8"
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
