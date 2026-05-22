import { LucideIcon, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MetricCardProps {
  title:       string;
  value:       string | number;
  sub?:        string;
  icon?:       LucideIcon;
  iconClass?:  string;
  trend?:      number;
  trendLabel?: string;
  accent?:     'blue' | 'green' | 'red' | 'orange' | 'purple' | 'gray';
  loading?:    boolean;
  onClick?:    () => void;
}

const accentMap = {
  blue:   'bg-blue-50 text-blue-600',
  green:  'bg-green-50 text-green-600',
  red:    'bg-red-50 text-red-600',
  orange: 'bg-orange-50 text-orange-600',
  purple: 'bg-purple-50 text-purple-600',
  gray:   'bg-gray-100 text-gray-600',
};

export function MetricCard({
  title, value, sub, icon: Icon, iconClass,
  trend, trendLabel, accent = 'blue', loading, onClick,
}: MetricCardProps) {
  const trendPositive = trend != null && trend > 0;
  const trendNegative = trend != null && trend < 0;

  return (
    <div
      onClick={onClick}
      className={cn(
        'bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-3',
        onClick && 'cursor-pointer hover:border-blue-300 hover:shadow-sm transition-all',
      )}
    >
      <div className="flex items-start justify-between">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</p>
        {Icon && (
          <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', accentMap[accent], iconClass)}>
            <Icon size={16} />
          </div>
        )}
      </div>

      {loading ? (
        <div className="h-8 w-24 bg-gray-100 rounded animate-pulse" />
      ) : (
        <p className="text-2xl font-bold text-gray-900 leading-none">{value}</p>
      )}

      <div className="flex items-center gap-2">
        {trend != null && (
          <div className={cn(
            'flex items-center gap-0.5 text-xs font-semibold',
            trendPositive ? 'text-green-600' : trendNegative ? 'text-red-600' : 'text-gray-500',
          )}>
            {trendPositive
              ? <TrendingUp size={12} />
              : trendNegative
                ? <TrendingDown size={12} />
                : <Minus size={12} />
            }
            {Math.abs(trend).toFixed(1)}%
          </div>
        )}
        {(trendLabel ?? sub) && (
          <p className="text-xs text-gray-500 truncate">{trendLabel ?? sub}</p>
        )}
      </div>
    </div>
  );
}
