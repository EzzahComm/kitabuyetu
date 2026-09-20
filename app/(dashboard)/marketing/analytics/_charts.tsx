'use client';

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { chartTheme, tone, brandNavy } from '@/lib/ui/tokens';
import type { AutomationVolumePoint } from '@/lib/services/marketing-analytics.service';

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-KE', { month: 'short', day: 'numeric' });
}

export function AutomationVolumeChart({ points }: { points: AutomationVolumePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={points.map((p) => ({ ...p, date: fmtDay(p.date) }))}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
        <XAxis dataKey="date" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey="sms" stroke={brandNavy[500]} strokeWidth={2} dot={false} name="SMS sent" />
        <Line
          type="monotone"
          dataKey="email"
          stroke={tone.positive.solid}
          strokeWidth={2}
          dot={false}
          name="Email sent"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
