'use client';

import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
  type TooltipValueType,
} from 'recharts';
import { formatKES } from '@/lib/utils';

function tooltipNumber(v: TooltipValueType | undefined): number | string | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : (v as number | string);
}

/**
 * Revenue trend chart for the admin dashboard, split into its own module so the
 * admin overview can lazy-load Recharts (`next/dynamic`, ssr:false) instead of
 * shipping the ~360 KB library in the page's first-load bundle.
 */
export default function RevenueChart({ data }: { data: { month: string; revenue: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#2563eb" stopOpacity={0.15} />
            <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} />
        <YAxis
          tick={{ fontSize: 11, fill: '#6b7280' }}
          tickLine={false} axisLine={false}
          tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
        />
        <Tooltip
          formatter={(v) => [formatKES(tooltipNumber(v)), 'Revenue']}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
        />
        <Area
          type="monotone" dataKey="revenue"
          stroke="#2563eb" strokeWidth={2}
          fill="url(#revGrad)"
          dot={false} activeDot={{ r: 4, fill: '#2563eb' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
