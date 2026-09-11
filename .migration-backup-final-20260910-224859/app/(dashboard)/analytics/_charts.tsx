'use client';

import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { chartPalette, chartTheme, tone, brandNavy, brandOrange } from '@/lib/ui/tokens';

type Grain = 'day' | 'month';
type Tier = 'excellent' | 'good' | 'fair' | 'poor' | 'high_risk';

const fmtMoney = (v: string | number | null | undefined) =>
  new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(Number(v ?? 0));

const TIER_COLOR: Record<Tier, string> = {
  excellent: tone.positive.solid,
  good:      brandNavy[500],
  fair:      tone.warning.solid,
  poor:      brandOrange[500],
  high_risk: tone.negative.solid,
};
const TIER_LABEL: Record<Tier, string> = {
  excellent: 'Excellent', good: 'Good', fair: 'Fair', poor: 'Poor', high_risk: 'High risk',
};
const PORTFOLIO_COLORS = [chartPalette[0], chartPalette[1], chartPalette[2]];

function fmtBucket(iso: string, grain: Grain): string {
  const d = new Date(iso);
  if (grain === 'month') return d.toLocaleDateString('en-KE', { month: 'short', year: '2-digit' });
  return d.toLocaleDateString('en-KE', { month: 'short', day: 'numeric' });
}

function formatAxisMoney(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000)     return `${(v / 1_000).toFixed(0)}K`;
  return v.toString();
}

export function ContributionsChart({
  buckets, grain,
}: {
  buckets: { bucket: string; amount: string }[];
  grain: Grain;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={buckets.map((b) => ({
        bucket: fmtBucket(b.bucket, grain),
        amount: Number(b.amount),
      }))}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
        <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatAxisMoney(v)} />
        <Tooltip formatter={(v) => fmtMoney(Number(v ?? 0))} />
        <Line type="monotone" dataKey="amount" stroke={tone.positive.solid} strokeWidth={2} dot={{ r: 3 }} name="Amount" />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function RepaymentsChart({
  buckets, grain,
}: {
  buckets: { bucket: string; amount: string }[];
  grain: Grain;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={buckets.map((b) => ({
        bucket: fmtBucket(b.bucket, grain),
        amount: Number(b.amount),
      }))}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
        <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatAxisMoney(v)} />
        <Tooltip formatter={(v) => fmtMoney(Number(v ?? 0))} />
        <Bar dataKey="amount" fill={brandNavy[500]} name="Repaid" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function PortfolioDonutChart({
  contributionsTotal, shareCapital, loansOutstanding,
}: {
  contributionsTotal: string; shareCapital: string; loansOutstanding: string;
}) {
  const data = [
    { name: 'Contributions', value: Number(contributionsTotal) },
    { name: 'Share capital', value: Number(shareCapital) },
    { name: 'Loans (outstanding)', value: Number(loansOutstanding) },
  ].filter((d) => d.value > 0);

  if (data.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
          {data.map((_, i) => <Cell key={i} fill={PORTFOLIO_COLORS[i % PORTFOLIO_COLORS.length]} />)}
        </Pie>
        <Tooltip formatter={(v) => fmtMoney(Number(v ?? 0))} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function CreditTierChart({ byTier }: { byTier: Record<Tier, number> }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={(Object.keys(byTier) as Tier[]).map((t) => ({
            name: TIER_LABEL[t],
            value: byTier[t],
            tier:  t,
          })).filter((d) => d.value > 0)}
          dataKey="value"
          nameKey="name"
          innerRadius={55}
          outerRadius={85}
          paddingAngle={2}
        >
          {(Object.keys(byTier) as Tier[]).map((t) => (
            <Cell key={t} fill={TIER_COLOR[t]} />
          ))}
        </Pie>
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
