'use client';

import * as React from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { chartPalette, chartTheme } from '@/lib/ui/tokens';
import { formatKES } from '@/lib/utils';
import { cn } from '@/lib/utils';

/**
 * Themed Recharts kit. Every chart in Kitabu Yetu should go through these
 * wrappers so colours (brand palette), axes, grid, and tooltips stay identical
 * — no more ad-hoc hex literals scattered across pages.
 */

interface ChartCardProps {
  title?: string;
  description?: string;
  /** Right-aligned header slot (range selector, legend toggle…). */
  action?: React.ReactNode;
  height?: number;
  className?: string;
  children: React.ReactElement;
}

/** Card shell + responsive container that sizes any chart consistently. */
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
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            {children}
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
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

export interface SeriesDef {
  /** Data key in each datum. */
  key: string;
  /** Legend / tooltip label. */
  label?: string;
  /** Override colour; defaults to the palette by index. */
  color?: string;
}

// ── Trend (area) chart ───────────────────────────────────────────────────────
interface TrendChartProps {
  data: Record<string, unknown>[];
  xKey: string;
  series: SeriesDef[];
  money?: boolean;
}

/** Smooth gradient area chart — for balances, contributions, savings over time. */
export function TrendChart({ data, xKey, series, money = true }: TrendChartProps) {
  return (
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

/** Categorical/temporal bar chart — repayments, disbursements, attendance. */
export function BarSeriesChart({ data, xKey, series, money = true, stacked }: BarSeriesChartProps) {
  return (
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
  );
}

// ── Donut chart ──────────────────────────────────────────────────────────────
interface DonutChartProps {
  data: { name: string; value: number }[];
  money?: boolean;
  colors?: string[];
}

/** Donut for portfolio splits, risk tiers, allocation breakdowns. */
export function DonutChart({ data, money = true, colors = [...chartPalette] }: DonutChartProps) {
  return (
    <PieChart>
      <Pie data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="82%" paddingAngle={2}>
        {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
      </Pie>
      <Tooltip content={<ChartTooltip money={money} />} />
      <Legend wrapperStyle={{ fontSize: chartTheme.fontSize }} />
    </PieChart>
  );
}

// ── Sparkline ────────────────────────────────────────────────────────────────
/** Tiny inline trend for stat cards — no axes, no grid. */
export function Sparkline({ data, dataKey, color = chartPalette[0], height = 40, className }: {
  data: Record<string, unknown>[]; dataKey: string; color?: string; height?: number; className?: string;
}) {
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
