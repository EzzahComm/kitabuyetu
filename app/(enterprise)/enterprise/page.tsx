'use client';

import * as React from 'react';
import Link from 'next/link';
import { Users2, PiggyBank, Landmark, AlertTriangle, Network, Layers, Download, ArrowRight, Info } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { StatusPill } from '@/components/shared/status-pill';
import { MoneyDisplay } from '@/components/shared/money-display';
import { ChartCard, TrendChart, DonutChart, Sparkline } from '@/components/shared/charts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { formatKES } from '@/lib/utils';
import { tone } from '@/lib/ui/tokens';
import { portfolio, portfolioTrend, savingsByRegion, impact, branches } from '../_data';

const fmtCompact = (n: number) => {
  if (n >= 1_000_000) return `KES ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `KES ${(n / 1_000).toFixed(0)}K`;
  return formatKES(n);
};

const branchStatusTone = { active: 'positive', review: 'warning', onboarding: 'info' } as const;

export default function EnterpriseDashboardPage() {
  const topBranches = [...branches].sort((a, b) => b.savings - a.savings).slice(0, 5);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Portfolio Overview"
        description="Consolidated performance across all branches and affiliated groups"
        actions={
          <>
            <Button variant="outline" size="sm"><Download className="h-4 w-4" /> Export</Button>
            <Button size="sm">Last 6 months</Button>
          </>
        }
      />

      {/* KPI grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard title="Total members" value={portfolio.members.toLocaleString()} icon={Users2} trend={{ value: portfolio.membersGrowth, label: 'YoY' }} />
        <StatCard title="Total savings" value={fmtCompact(portfolio.savings)} icon={PiggyBank} trend={{ value: portfolio.savingsGrowth, label: 'YoY' }} />
        <StatCard title="Loans outstanding" value={fmtCompact(portfolio.loansOut)} icon={Landmark} />
        <StatCard title="Portfolio at risk" value={`${portfolio.par}%`} icon={AlertTriangle} description=">30 days" />
        <StatCard title="Active groups" value={portfolio.activeGroups.toLocaleString()} icon={Layers} />
        <StatCard title="Branches" value={portfolio.branches} icon={Network} />
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-3">
        <ChartCard title="Portfolio growth" description="Savings vs loans outstanding" height={280} className="lg:col-span-2">
          <TrendChart
            data={portfolioTrend}
            xKey="month"
            series={[{ key: 'savings', label: 'Savings' }, { key: 'loans', label: 'Loans out' }]}
          />
        </ChartCard>
        <ChartCard title="Savings by region" height={280}>
          <DonutChart data={savingsByRegion} />
        </ChartCard>
      </div>

      {/* Program impact + branch comparison */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Impact analytics */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Program impact</CardTitle>
            <p className="text-xs text-muted-foreground">Reach &amp; outcomes for funder reporting</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {impact.map((m) => (
              <div key={m.label}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="text-foreground">{m.label}</span>
                  <span className="font-semibold text-foreground">{m.value}%</span>
                </div>
                <Progress value={m.value} />
                <p className="mt-0.5 text-xs text-muted-foreground">{m.hint}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Branch comparison */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-base">Top branches</CardTitle>
              <p className="text-xs text-muted-foreground">By total savings</p>
            </div>
            <Link href="/enterprise/branches">
              <Button variant="ghost" size="sm" className="text-xs">All branches <ArrowRight size={12} className="ml-1" /></Button>
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Branch</th>
                  <th className="px-4 py-2 text-right font-medium">Members</th>
                  <th className="px-4 py-2 text-right font-medium">Savings</th>
                  <th className="hidden px-4 py-2 text-right font-medium sm:table-cell">PAR</th>
                  <th className="hidden px-4 py-2 font-medium md:table-cell">Trend</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {topBranches.map((b) => (
                  <tr key={b.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-foreground">{b.name}</p>
                      <p className="text-xs text-muted-foreground">{b.region}</p>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{b.members.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right"><MoneyDisplay amount={b.savings} size="sm" /></td>
                    <td className="hidden px-4 py-2.5 text-right tabular-nums sm:table-cell">
                      <span className={b.par > 6 ? 'font-medium text-red-600' : 'text-muted-foreground'}>{b.par}%</span>
                    </td>
                    <td className="hidden px-4 py-2.5 md:table-cell">
                      <div className="w-24"><Sparkline data={b.trend} dataKey="v" height={28} color={tone.positive.solid} /></div>
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusPill status={b.status} tone={branchStatusTone[b.status]} label={b.status} size="sm" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>Representative data for UI review. Wire <code className="font-mono">_data.ts</code> to a <code className="font-mono">usePortfolio()</code> hook aggregating across child groups.</span>
      </div>
    </div>
  );
}
