'use client';

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

export function ScoreHistoryChart({
  history,
}: {
  history: { computed_at: string; overall_score: string; financial_score: string }[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={[...history].reverse().map((h) => ({
        date:      new Date(h.computed_at).toLocaleDateString(),
        overall:   Number(h.overall_score),
        financial: Number(h.financial_score),
      }))}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
        <Tooltip />
        <Line type="monotone" dataKey="overall"  stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} name="Overall" />
        <Line type="monotone" dataKey="financial" stroke="#2563eb" strokeWidth={1.5} dot={false} name="Financial" />
      </LineChart>
    </ResponsiveContainer>
  );
}
