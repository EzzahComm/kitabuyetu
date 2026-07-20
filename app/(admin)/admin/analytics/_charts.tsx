'use client';

import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { formatKES } from '@/lib/utils';

export function GrowthChart({ data }: { data: Record<string, unknown>[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="growthGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }} />
        <Area type="monotone" dataKey="cumulative_groups" name="Total Groups"
          stroke="#3b82f6" strokeWidth={2} fill="url(#growthGrad)" dot={false} />
        <Area type="monotone" dataKey="new_groups" name="New This Month"
          stroke="#10b981" strokeWidth={1.5} fill="none" dot={false} strokeDasharray="4 2" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function TopGroupsChart({ data }: { data: Record<string, unknown>[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false}
          tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#6b7280' }}
          tickLine={false} axisLine={false} width={120} />
        <Tooltip
          formatter={(v: any, n) => [
            formatKES(v),
            String(n) === 'contributions' ? 'Contributions' : 'Loan Book',
          ] as [string, string]}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
        />
        <Bar dataKey="contributions" name="Contributions" fill="#3b82f6" radius={[0, 4, 4, 0]} />
        <Bar dataKey="loan_book" name="Loan Book" fill="#7c3aed" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
