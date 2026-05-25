'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  Activity, AlertTriangle, BarChart2, Coins, Download, Heart, Landmark,
  Loader2, ReceiptText, TrendingUp, Users, Vault,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { api } from '@/lib/api/client';

type Period = '30d' | '90d' | '12mo' | 'all';
type Tier   = 'excellent' | 'good' | 'fair' | 'poor' | 'high_risk';

interface ExecutiveSummary {
  period: Period; grain: 'day' | 'month'; generatedAt: string;
  members: { total: number; active: number; pending: number; archived: number; joinedInPeriod: number };
  contributions: {
    totalAmount: string; periodAmount: string; periodCount: number;
    monthlyBuckets: { bucket: string; amount: string; count: number }[];
    topMembers: { memberId: string; firstName: string; lastName: string; amount: string }[];
  };
  loans: {
    activeCount: number; activePrincipal: string; outstandingBalance: string;
    repaymentsInPeriod: string; overdueCount: number; defaultedCount: number;
    topBorrowers: { memberId: string; firstName: string; lastName: string; outstanding: string }[];
    monthlyRepayments: { bucket: string; amount: string }[];
  };
  welfare: { poolBalance: string; totalDisbursed: string; pendingRequests: number };
  shares: {
    shareCapital: string; sharesIssued: number; shareholders: number;
    topHolders: { memberId: string; firstName: string; lastName: string; shares: number; invested: string }[];
  };
  dividends: { totalDeclared: string; totalPaid: string; lastDeclarationAt: string | null; lastDeclarationLabel: string | null };
  creditScores: { scoredMembers: number; averageOverall: string; byTier: Record<Tier, number> };
  financialHealth: { grossAssets: string; liabilities: string; netPosition: string };
}

const fmtMoney = (v: string | number | null | undefined) =>
  new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(Number(v ?? 0));
const fmtInt = (v: number | string | null | undefined) =>
  new Intl.NumberFormat('en-KE').format(Number(v ?? 0));

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: '30d',  label: 'Last 30 days' },
  { value: '90d',  label: 'Last 90 days' },
  { value: '12mo', label: 'Last 12 months' },
  { value: 'all',  label: 'All time' },
];

const TIER_COLOR: Record<Tier, string> = {
  excellent: '#16a34a',
  good:      '#2563eb',
  fair:      '#a16207',
  poor:      '#ea580c',
  high_risk: '#dc2626',
};
const TIER_LABEL: Record<Tier, string> = {
  excellent: 'Excellent', good: 'Good', fair: 'Fair', poor: 'Poor', high_risk: 'High risk',
};
const PORTFOLIO_COLORS = ['#16a34a', '#2563eb', '#a16207'];

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>('12mo');

  const summaryQ = useQuery<ExecutiveSummary>({
    queryKey: ['analytics', 'executive', period],
    queryFn:  () => api.get<ExecutiveSummary>(`/analytics/executive?period=${period}`),
  });

  const s = summaryQ.data;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Executive view across members, finances, shares, dividends and credit health.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button asChild variant="outline" size="sm">
            <Link href="/analytics/risk"><AlertTriangle className="mr-2 h-4 w-4" /> Risk analysis</Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download className="mr-2 h-4 w-4" /> Export CSV
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild><a href="/api/v1/analytics/export?type=members"        download>Members</a></DropdownMenuItem>
              <DropdownMenuItem asChild><a href="/api/v1/analytics/export?type=contributions"  download>Contributions</a></DropdownMenuItem>
              <DropdownMenuItem asChild><a href="/api/v1/analytics/export?type=loans"          download>Loans</a></DropdownMenuItem>
              <DropdownMenuItem asChild><a href="/api/v1/analytics/export?type=share_holdings" download>Share holdings</a></DropdownMenuItem>
              <DropdownMenuItem asChild><a href="/api/v1/analytics/export?type=credit_scores"  download>Credit scores</a></DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <label htmlFor="period" className="text-xs text-muted-foreground ml-2">Period</label>
          <select
            id="period"
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {PERIOD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {summaryQ.isLoading || !s ? (
        <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <>
          {/* KPI grid */}
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Total members"        value={fmtInt(s.members.total)}                 sub={`${fmtInt(s.members.active)} active`} icon={<Users        className="h-4 w-4" />} />
            <Kpi label="New this period"      value={fmtInt(s.members.joinedInPeriod)}        sub={periodLabel(period)} icon={<Activity     className="h-4 w-4" />} />
            <Kpi label="Contributions"        value={fmtMoney(s.contributions.periodAmount)}  sub={`${fmtInt(s.contributions.periodCount)} payments`} icon={<TrendingUp   className="h-4 w-4" />} />
            <Kpi label="Loan portfolio"       value={fmtMoney(s.loans.outstandingBalance)}    sub={`${fmtInt(s.loans.activeCount)} active · ${fmtInt(s.loans.overdueCount)} overdue`} icon={<Landmark     className="h-4 w-4" />} />

            <Kpi label="Share capital"        value={fmtMoney(s.shares.shareCapital)}         sub={`${fmtInt(s.shares.sharesIssued)} shares · ${fmtInt(s.shares.shareholders)} holders`} icon={<Coins        className="h-4 w-4" />} />
            <Kpi label="Dividends paid"       value={fmtMoney(s.dividends.totalPaid)}         sub={s.dividends.lastDeclarationLabel ? `Last: ${s.dividends.lastDeclarationLabel}` : 'No declarations yet'} icon={<ReceiptText  className="h-4 w-4" />} />
            <Kpi label="Welfare fund"         value={fmtMoney(s.welfare.poolBalance)}         sub={`${fmtInt(s.welfare.pendingRequests)} pending requests`} icon={<Heart        className="h-4 w-4" />} />
            <Kpi label="Avg credit score"     value={s.creditScores.scoredMembers > 0 ? Number(s.creditScores.averageOverall).toFixed(0) : '—'} sub={`${fmtInt(s.creditScores.scoredMembers)} scored`} icon={<BarChart2    className="h-4 w-4" />} />
          </div>

          {/* Financial health */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Vault className="h-4 w-4" /> Financial health
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  Contributions + share capital − outstanding loans (welfare &amp; investments not included)
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-3">
                <HealthMetric label="Gross assets" value={fmtMoney(s.financialHealth.grossAssets)} tone="positive" />
                <HealthMetric label="Liabilities"  value={fmtMoney(s.financialHealth.liabilities)}  tone="warning" />
                <HealthMetric label="Net position" value={fmtMoney(s.financialHealth.netPosition)}  tone={Number(s.financialHealth.netPosition) >= 0 ? 'positive' : 'negative'} highlight />
              </div>
            </CardContent>
          </Card>

          {/* Time-series charts row */}
          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Contributions over time</CardTitle></CardHeader>
              <CardContent>
                <div className="h-64">
                  {s.contributions.monthlyBuckets.length === 0 ? (
                    <EmptyChart label="No contributions in this period" />
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={s.contributions.monthlyBuckets.map((b) => ({
                        bucket: fmtBucket(b.bucket, s.grain),
                        amount: Number(b.amount),
                      }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                        <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatAxisMoney(v)} />
                        <Tooltip formatter={(v) => fmtMoney(Number(v ?? 0))} />
                        <Line type="monotone" dataKey="amount" stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} name="Amount" />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Loan repayments over time</CardTitle></CardHeader>
              <CardContent>
                <div className="h-64">
                  {s.loans.monthlyRepayments.length === 0 ? (
                    <EmptyChart label="No repayments in this period" />
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={s.loans.monthlyRepayments.map((b) => ({
                        bucket: fmtBucket(b.bucket, s.grain),
                        amount: Number(b.amount),
                      }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                        <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatAxisMoney(v)} />
                        <Tooltip formatter={(v) => fmtMoney(Number(v ?? 0))} />
                        <Bar dataKey="amount" fill="#2563eb" name="Repaid" />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Portfolio composition + credit tier distribution */}
          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Portfolio composition</CardTitle></CardHeader>
              <CardContent>
                <div className="h-64">
                  <PortfolioDonut s={s} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Credit score tiers</CardTitle></CardHeader>
              <CardContent>
                <div className="h-64">
                  {s.creditScores.scoredMembers === 0 ? (
                    <EmptyChart label="No scores computed yet — visit /credit-scores to recompute." />
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={(Object.keys(s.creditScores.byTier) as Tier[]).map((t) => ({
                            name: TIER_LABEL[t],
                            value: s.creditScores.byTier[t],
                            tier:  t,
                          })).filter((d) => d.value > 0)}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={55}
                          outerRadius={85}
                          paddingAngle={2}
                        >
                          {(Object.keys(s.creditScores.byTier) as Tier[]).map((t) => (
                            <Cell key={t} fill={TIER_COLOR[t]} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Top-N lists */}
          <div className="grid gap-3 lg:grid-cols-3">
            <TopList
              title="Top contributors"
              empty="No contributions in this period"
              items={s.contributions.topMembers.map((r) => ({
                key:   r.memberId,
                left:  `${r.firstName} ${r.lastName}`,
                right: fmtMoney(r.amount),
              }))}
            />
            <TopList
              title="Largest outstanding loans"
              empty="No active loans"
              items={s.loans.topBorrowers.map((r) => ({
                key:   r.memberId,
                left:  `${r.firstName} ${r.lastName}`,
                right: fmtMoney(r.outstanding),
              }))}
            />
            <TopList
              title="Top shareholders"
              empty="No shareholders yet"
              items={s.shares.topHolders.map((r) => ({
                key:   r.memberId,
                left:  `${r.firstName} ${r.lastName}`,
                right: `${fmtInt(r.shares)} shares`,
              }))}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Generated {new Date(s.generatedAt).toLocaleString()} ·
            <Link href="/credit-scores" className="ml-1 text-primary hover:underline">credit scores</Link> ·
            <Link href="/shares" className="ml-1 text-primary hover:underline">shares ledger</Link> ·
            <Link href="/dividends" className="ml-1 text-primary hover:underline">dividends</Link>
          </p>
        </>
      )}
    </div>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────

function Kpi({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase text-muted-foreground">{label}</p>
          <span className="text-muted-foreground">{icon}</span>
        </div>
        <p className="mt-1 text-2xl font-semibold">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function HealthMetric({ label, value, tone, highlight }: {
  label: string; value: string;
  tone: 'positive' | 'negative' | 'warning';
  highlight?: boolean;
}) {
  const toneClass = tone === 'positive' ? 'text-green-600' : tone === 'negative' ? 'text-red-600' : 'text-amber-600';
  return (
    <div className={highlight ? 'rounded-md border border-primary/20 bg-primary/5 p-3' : 'p-3'}>
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function PortfolioDonut({ s }: { s: ExecutiveSummary }) {
  const data = [
    { name: 'Contributions', value: Number(s.contributions.totalAmount) },
    { name: 'Share capital', value: Number(s.shares.shareCapital) },
    { name: 'Loans (outstanding)', value: Number(s.loans.outstandingBalance) },
  ].filter((d) => d.value > 0);

  if (data.length === 0) return <EmptyChart label="No portfolio data yet" />;

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

function TopList({ title, items, empty }: {
  title: string;
  items: { key: string; left: string; right: string }[];
  empty: string;
}) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ol className="space-y-2">
            {items.map((it, i) => (
              <li key={it.key} className="flex items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant="outline" className="shrink-0 font-mono">#{i + 1}</Badge>
                  <span className="truncate">{it.left}</span>
                </div>
                <span className="font-mono font-medium shrink-0">{it.right}</span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyChart({ label }: { label: string }) {
  return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{label}</div>;
}

// ── Formatting helpers ───────────────────────────────────────────────

function fmtBucket(iso: string, grain: 'day' | 'month'): string {
  const d = new Date(iso);
  if (grain === 'month') return d.toLocaleDateString('en-KE', { month: 'short', year: '2-digit' });
  return d.toLocaleDateString('en-KE', { month: 'short', day: 'numeric' });
}

function formatAxisMoney(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000)     return `${(v / 1_000).toFixed(0)}K`;
  return v.toString();
}

function periodLabel(p: Period): string {
  return ({ '30d': 'last 30 days', '90d': 'last 90 days', '12mo': 'last 12 months', all: 'all time' } as const)[p];
}
