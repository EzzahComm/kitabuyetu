import { type LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface StatCardProps {
  title:       string;
  value:       string | number;
  description?: string;
  icon?:       LucideIcon;
  trend?:      { value: number; label: string };
  className?:  string;
  iconClass?:  string;
}

export function StatCard({ title, value, description, icon: Icon, trend, className, iconClass }: StatCardProps) {
  return (
    <Card className={className}>
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold">{value}</p>
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
            {trend && (
              <p className={cn('text-xs font-medium', trend.value >= 0 ? 'text-green-600' : 'text-red-600')}>
                {trend.value >= 0 ? '+' : ''}{trend.value}% {trend.label}
              </p>
            )}
          </div>
          {Icon && (
            <div className={cn('h-10 w-10 rounded-full flex items-center justify-center bg-brand-50', iconClass)}>
              <Icon className="h-5 w-5 text-brand-600" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
