'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { formatKES } from '@/lib/utils';

export function RevenueByPlanChart({
  data, colors,
}: {
  data: { plan: string; revenue: string | number }[];
  colors: Record<string, string>;
}) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="plan" tick={{ fontSize: 12, fill: '#6b7280' }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false}
          tickFormatter={(v: number) => formatKES(v)} />
        <Tooltip formatter={(v: any) => [formatKES(v), 'Revenue']}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }} />
        <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
          {data.map((entry) => (
            <Cell key={entry.plan} fill={colors[entry.plan] ?? '#94a3b8'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
