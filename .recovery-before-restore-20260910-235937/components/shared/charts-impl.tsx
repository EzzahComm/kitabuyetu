'use client';

import * as React from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { chartPalette, chartTheme } from '@/lib/ui/tokens';
import { cn, formatKES } from '@/lib/utils';

/**
 * Recharts implementation for the themed chart kit.
 *
 * This module is the ONLY place Recharts is imported, and it is loaded lazily
 * (via `next/dynamic` in charts.tsx) so the ~360 KB library lands in an
 * on-demand chunk instead of every chart page's first-load bundle. Each export
 * is self-contained (includes its own ResponsiveContainer) so it can be the
 * dynamic boundary.
 */

export interface SeriesDef {
  /** Data key in each datum. */
  key: string;
  /** Legend / tooltip label. */
  label?: string;
  /** Override colour; defaults to the palette by index. */
  color?: string;
}

// ── Shared tooltip ───────────────────────────────────────────────────────────
interface TooltipPayloadItem { name?: string; value?: number | string; color?: string; dataKey?: string | number }

function ChartTooltip({
  active, payload, label, money,
}: { active?: boolean; payload?: TooltipPayloadItem[]; label?: string; money?: boolean }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      {label && <p className="mb-1 font-medium text-foreground">{label}</p>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto font-medium text-foreground">
            {money && typeof p.value === 'number' ? formatKES(p.value) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

const axisProps = {
  stroke: chartTheme.axis,
  tick: { fontSize: chartTheme.fontSize, fill: chartTheme.axisLabel },
  tickLine: false,
  axisLine: false,
} as const;

// ── Trend (area) chart ───────────────────────────────────────────────────────
interface TrendChartProps {
  data: Record<string, unknown>[];
  xKey: string;
  series: SeriesDef[];
  money?: boolean;
}

export function TrendChartImpl({ data, xKey, series, money = true }: TrendChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          {series.map((s, i) => {
            const color = s.color ?? chartPalette[i % chartPalette.length];
            return (
              <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.25} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            );
          })}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
        <XAxis dataKey={xKey} {...axisProps} />
        <YAxis {...axisProps} width={money ? 64 : 40} />
        <Tooltip content={<ChartTooltip money={money} />} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: chartTheme.fontSize }} />}
        {series.map((s, i) => {
          const color = s.color ?? chartPalette[i % chartPalette.length];
          return (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label ?? s.key}
              stroke={color}
              strokeWidth={2}
              fill={`url(#grad-${s.key})`}
            />
          );
        })}
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Bar chart ────────────────────────────────────────────────────────────────
interface BarSeriesChartProps {
  data: Record<string, unknown>[];
  xKey: string;
  series: SeriesDef[];
  money?: boolean;
  stacked?: boolean;
}

export function BarSeriesChartImpl({ data, xKey, series, money = true, stacked }: BarSeriesChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
        <XAxis dataKey={xKey} {...axisProps} />
        <YAxis {...axisProps} width={money ? 64 : 40} />
        <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} content={<ChartTooltip money={money} />} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: chartTheme.fontSize }} />}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label ?? s.key}
            fill={s.color ?? chartPalette[i % chartPalette.length]}
            radius={[4, 4, 0, 0]}
            stackId={stacked ? 'stack' : undefined}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Donut chart ──────────────────────────────────────────────────────────────
interface DonutChartProps {
  data: { name: string; value: number }[];
  money?: boolean;
  colors?: string[];
}

export function DonutChartImpl({ data, money = true, colors = [...chartPalette] }: DonutChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="82%" paddingAngle={2}>
          {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
        </Pie>
        <Tooltip content={<ChartTooltip money={money} />} />
        <Legend wrapperStyle={{ fontSize: chartTheme.fontSize }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ── Sparkline ────────────────────────────────────────────────────────────────
interface SparklineProps {
  data: Record<string, unknown>[];
  dataKey: string;
  color?: string;
  height?: number;
  className?: string;
}

export function SparklineImpl({ data, dataKey, color = chartPalette[0], height = 40, className }: SparklineProps) {
  return (
    <div style={{ height }} className={cn('w-full', className)}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`spark-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fill={`url(#spark-${dataKey})`} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
