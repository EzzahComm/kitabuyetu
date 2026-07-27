'use client';

import { useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
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
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { api } from '@/lib/api/client';
import { downloadAuthenticated } from '@/lib/utils/download';
import { useToast } from '@/hooks/use-toast';

// OPTIMIZATION_CLEANUP_AUDIT.md Medium #26 — recharts is code-split out of
// this page's initial bundle; it's only needed once the summary loads.
const ContributionsChart = dynamic(() => import('./_charts').then((m) => m.ContributionsChart), { ssr: false });
const RepaymentsChart    = dynamic(() => import('./_charts').then((m) => m.RepaymentsChart),    { ssr: false });
const PortfolioDonutChart = dynamic(() => import('./_charts').then((m) => m.PortfolioDonutChart), { ssr: false });
const CreditTierChart    = dynamic(() => import('./_charts').then((m) => m.CreditTierChart),    { ssr: false });

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

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>('12mo');
  const [exporting, setExporting] = useState<string | null>(null);
  const { toast } = useToast();

  const summaryQ = useQuery<ExecutiveSummary>({
    queryKey: ['analytics', 'executive', period],
    queryFn:  () => api.get<ExecutiveSummary>(`/analytics/executive?period=${period}`),
  });

  const s = summaryQ.data;

  // Auth'd CSV download. A plain <a href download> would 401 because the
  // JWT lives in localStorage and isn't sent on navigation requests.
  const exportCsv = async (kind: string) => {
    setExporting(kind);
    try {
      await downloadAuthenticated(`/api/v1/analytics/export?type=${kind}`, {
        fallbackFilename: `${kind}-${new Date().toISOString().slice(0, 10)}.csv`,
      });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: `Export failed`,
        description: (err as Error).message,
      });
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Analytics"
        description="Executive view across members, finances, shares, dividends and credit health."
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/analytics/risk"><AlertTriangle className="mr-2 h-4 w-4" /> Risk analysis</Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={exporting !== null}>
                  {exporting
                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Exporting…</>
                    : <><Download className="mr-2 h-4 w-4" /> Export CSV</>}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => exportCsv('members')}>Members</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportCsv('contributions')}>Contributions</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportCsv('loans')}>Loans</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportCsv('share_holdings')}>Share holdings</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportCsv('credit_scores')}>Credit scores</DropdownMenuItem>
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
          </>
        }
      />

      {summaryQ.isLoading || !s ? (
        <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <>
          {/* KPI grid */}
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <StatCard title="Total members"    value={fmtInt(s.members.total)}                 description={`${fmtInt(s.members.active)} active`} icon={Users} />
            <StatCard title="New this period"  value={fmtInt(s.members.joinedInPeriod)}        description={periodLabel(period)} icon={Activity} />
            <StatCard title="Contributions"    value={fmtMoney(s.contributions.periodAmount)}  description={`${fmtInt(s.contributions.periodCount)} payments`} icon={TrendingUp} />
            <StatCard title="Loan portfolio"   value={fmtMoney(s.loans.outstandingBalance)}    description={`${fmtInt(s.loans.activeCount)} active · ${fmtInt(s.loans.overdueCount)} overdue`} icon={Landmark} />

            <StatCard title="Share capital"    value={fmtMoney(s.shares.shareCapital)}         description={`${fmtInt(s.shares.sharesIssued)} shares · ${fmtInt(s.shares.shareholders)} holders`} icon={Coins} />
            <StatCard title="Dividends paid"   value={fmtMoney(s.dividends.totalPaid)}         description={s.dividends.lastDeclarationLabel ? `Last: ${s.dividends.lastDeclarationLabel}` : 'No declarations yet'} icon={ReceiptText} />
            <StatCard title="Welfare fund"     value={fmtMoney(s.welfare.poolBalance)}         description={`${fmtInt(s.welfare.pendingRequests)} pending requests`} icon={Heart} />
            <StatCard title="Avg credit score" value={s.creditScores.scoredMembers > 0 ? Number(s.creditScores.averageOverall).toFixed(0) : '—'} description={`${fmtInt(s.creditScores.scoredMembers)} scored`} icon={BarChart2} />
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
                    <ContributionsChart buckets={s.contributions.monthlyBuckets} grain={s.grain} />
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
                    <RepaymentsChart buckets={s.loans.monthlyRepayments} grain={s.grain} />
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
                  {(Number(s.contributions.totalAmount) + Number(s.shares.shareCapital) + Number(s.loans.outstandingBalance)) === 0 ? (
                    <EmptyChart label="No portfolio data yet" />
                  ) : (
                    <PortfolioDonutChart
                      contributionsTotal={s.contributions.totalAmount}
                      shareCapital={s.shares.shareCapital}
                      loansOutstanding={s.loans.outstandingBalance}
                    />
                  )}
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
                    <CreditTierChart byTier={s.creditScores.byTier} />
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

function periodLabel(p: Period): string {
  return ({ '30d': 'last 30 days', '90d': 'last 90 days', '12mo': 'last 12 months', all: 'all time' } as const)[p];
}
