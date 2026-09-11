'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

/**
 * Themed Recharts kit — public API.
 *
 * Recharts itself lives in ./charts-impl and is loaded lazily here via
 * `next/dynamic` ({ ssr: false }), so the ~360 KB library is split into an
 * on-demand chunk instead of every chart page's first-load bundle. The exported
 * names and props are unchanged, so call sites stay identical.
 */

export type { SeriesDef } from './charts-impl';

/** Placeholder shown while the Recharts chunk loads. Fills its container; a
 *  min-height keeps tiny sparklines from collapsing during the brief load. */
const chartLoading = () => (
  <div className="h-full min-h-[2.5rem] w-full animate-pulse rounded-md bg-muted" />
);

export const TrendChart = dynamic(() => import('./charts-impl').then((m) => m.TrendChartImpl), {
  ssr: false, loading: chartLoading,
});
export const BarSeriesChart = dynamic(() => import('./charts-impl').then((m) => m.BarSeriesChartImpl), {
  ssr: false, loading: chartLoading,
});
export const DonutChart = dynamic(() => import('./charts-impl').then((m) => m.DonutChartImpl), {
  ssr: false, loading: chartLoading,
});
export const Sparkline = dynamic(() => import('./charts-impl').then((m) => m.SparklineImpl), {
  ssr: false, loading: chartLoading,
});

interface ChartCardProps {
  title?: string;
  description?: string;
  /** Right-aligned header slot (range selector, legend toggle…). */
  action?: React.ReactNode;
  height?: number;
  className?: string;
  children: React.ReactNode;
}

/**
 * Card shell that sizes any chart consistently. Recharts-free — the chart
 * (a lazy `TrendChart`/`BarSeriesChart`/`DonutChart`) is passed as children and
 * fills the fixed-height box via its own ResponsiveContainer.
 */
export function ChartCard({ title, description, action, height = 256, className, children }: ChartCardProps) {
  return (
    <Card className={className}>
      {(title || action) && (
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
          <div className="space-y-1">
            {title && <CardTitle className="text-base">{title}</CardTitle>}
            {description && <CardDescription>{description}</CardDescription>}
          </div>
          {action}
        </CardHeader>
      )}
      <CardContent>
        <div style={{ height }}>{children}</div>
      </CardContent>
    </Card>
  );
}
