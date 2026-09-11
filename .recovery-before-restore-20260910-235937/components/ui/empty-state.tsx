import * as React from 'react';
import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Lucide icon shown in the tinted circle. */
  icon?: LucideIcon;
  title: string;
  /** Short guidance — what this area is for or why it's empty. */
  description?: string;
  /** Primary action (e.g. a <Button>). Rendered prominently. */
  action?: React.ReactNode;
  /** Secondary action / "learn more" link. */
  secondaryAction?: React.ReactNode;
  /** Compact spacing for inline / in-card use. */
  size?: 'sm' | 'md';
  /** 'error' swaps the icon tint to a danger color — a genuine fetch/permission
   *  failure reads very differently from "there's nothing here yet" and
   *  shouldn't look identical (UX_UI_OPTIMIZATION_AUDIT_2026-08.md Phase 1). */
  variant?: 'empty' | 'error';
}

/**
 * Empty-state with educational guidance — used wherever a list, table, or panel
 * has no data yet. Pairs an icon, a one-line title, supportive copy, and an
 * optional CTA so low-literacy users always know the next step.
 */
export function EmptyState({
  icon: Icon, title, description, action, secondaryAction, size = 'md', variant = 'empty', className, ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        size === 'md' ? 'gap-3 px-6 py-12' : 'gap-2 px-4 py-8',
        className,
      )}
      {...props}
    >
      {Icon && (
        <div
          className={cn(
            'flex items-center justify-center rounded-full',
            variant === 'error' ? 'bg-red-50 text-red-600' : 'bg-brand-50 text-brand-600',
            size === 'md' ? 'h-14 w-14' : 'h-11 w-11',
          )}
        >
          <Icon className={size === 'md' ? 'h-7 w-7' : 'h-5 w-5'} aria-hidden />
        </div>
      )}
      <div className="space-y-1">
        <h3 className={cn('font-semibold text-foreground', size === 'md' ? 'text-base' : 'text-sm')}>
          {title}
        </h3>
        {description && (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {(action || secondaryAction) && (
        <div className="mt-2 flex flex-col items-center gap-2 sm:flex-row">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
