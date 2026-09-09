import * as React from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Crumb {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Breadcrumb trail; the last item is rendered as the current page. */
  breadcrumbs?: Crumb[];
  /** Right-aligned actions — buttons, filters, export menus. */
  actions?: React.ReactNode;
  /** Optional content rendered below the header (tabs, filter bar). */
  children?: React.ReactNode;
  className?: string;
}

/**
 * Consistent page header for every portal screen: breadcrumbs, title,
 * supporting description, and a right-aligned actions slot. Keeps spacing and
 * typography hierarchy identical across admin, backoffice, enterprise, group,
 * and member views.
 */
export function PageHeader({
  title, description, breadcrumbs, actions, children, className,
}: PageHeaderProps) {
  return (
    <div className={cn('space-y-4', className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            {breadcrumbs.map((c, i) => {
              const last = i === breadcrumbs.length - 1;
              return (
                <li key={`${c.label}-${i}`} className="flex items-center gap-1">
                  {c.href && !last ? (
                    <Link href={c.href} className="transition-colors hover:text-foreground">
                      {c.label}
                    </Link>
                  ) : (
                    <span className={cn(last && 'font-medium text-foreground')} aria-current={last ? 'page' : undefined}>
                      {c.label}
                    </span>
                  )}
                  {!last && <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                </li>
              );
            })}
          </ol>
        </nav>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>

      {children}
    </div>
  );
}
