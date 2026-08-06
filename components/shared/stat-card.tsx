import { type LucideIcon, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** Icon-bubble tint. Default `brand` is the app's primary green; the rest exist
 *  so a KPI row can encode category (money / risk / people) at a glance —
 *  absorbed from the retired admin `MetricCard`
 *  (UX_UI_OPTIMIZATION_AUDIT_2026-08.md H1). */
const accentMap = {
  brand:  'bg-brand-50 text-brand-600',
  blue:   'bg-blue-50 text-blue-600',
  green:  'bg-green-50 text-green-600',
  red:    'bg-red-50 text-red-600',
  orange: 'bg-orange-50 text-orange-600',
  purple: 'bg-purple-50 text-purple-600',
  gray:   'bg-gray-100 text-gray-600',
};

interface StatCardProps {
  title:        string;
  value:        string | number;
  description?: string;
  icon?:        LucideIcon;
  trend?:       { value: number; label: string };
  accent?:      keyof typeof accentMap;
  /** Renders a skeleton in place of the value while the source query is in flight. */
  loading?:     boolean;
  /** Makes the whole tile a drill-down target. Renders a real <button>, so it is
   *  keyboard-focusable — `MetricCard` used a click-handler <div>, which was not. */
  onClick?:     () => void;
  className?:   string;
  /** Escape hatch for the bubble background only; wins over `accent` via twMerge. */
  iconClass?:   string;
}

export function StatCard({
  title, value, description, icon: Icon, trend,
  accent = 'brand', loading, onClick, className, iconClass,
}: StatCardProps) {
  const trendDir = trend ? Math.sign(trend.value) : 0;
  const TrendIcon = trendDir > 0 ? TrendingUp : trendDir < 0 ? TrendingDown : Minus;

  const body = (
    <CardContent className="p-6">
      <div className="flex items-start justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          {loading
            ? <Skeleton className="h-8 w-24" />
            : <p className="text-2xl font-bold">{value}</p>}
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
          {trend && (
            <p className={cn(
              'flex items-center gap-0.5 text-xs font-medium',
              trendDir > 0 ? 'text-green-600' : trendDir < 0 ? 'text-red-600' : 'text-muted-foreground',
            )}>
              <TrendIcon className="h-3 w-3" />
              {Math.abs(trend.value)}% {trend.label}
            </p>
          )}
        </div>
        {Icon && (
          <div className={cn('h-10 w-10 shrink-0 rounded-full flex items-center justify-center', accentMap[accent], iconClass)}>
            <Icon className="h-5 w-5" />
          </div>
        )}
      </div>
    </CardContent>
  );

  // Card renders a <div> and has no asChild, so an interactive tile is a real
  // <button> carrying the same card classes — keyboard-focusable and
  // Enter/Space-activatable, which the click-handler <div> it replaces was not.
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'rounded-lg border bg-card text-card-foreground shadow-sm w-full text-left',
          'transition-colors hover:border-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          className,
        )}
      >
        {body}
      </button>
    );
  }

  return <Card className={className}>{body}</Card>;
}
