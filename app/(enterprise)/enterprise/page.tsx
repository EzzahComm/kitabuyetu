'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Users2, PiggyBank, Landmark, Layers, Network, Download, ArrowRight, Clock, AlertCircle,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { StatusPill } from '@/components/shared/status-pill';
import { MoneyDisplay } from '@/components/shared/money-display';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PaginatedTable, singlePage } from '@/components/shared/paginated-table';
import { Skeleton } from '@/components/ui/skeleton';
import { organizationApi } from '@/lib/api/endpoints';
import { adminApi } from '@/lib/api/client';
import { formatKES, getErrorMessage } from '@/lib/utils';
import type { OrganizationGroupSummary } from '@/types/api.types';
import type { PaginatedResult } from '@/types/db.types';

interface OrgDashboard {
  /** null when the portfolio aggregate could not be read — NEVER zero-filled (R10). */
  portfolio: {
    linkedGroups: number; activeMembers: number; totalSavings: string;
    loanPortfolio: string; activeLoans: number; activePrograms?: number;
  } | null;
  /** Sections the server could not read, e.g. ['portfolio']. */
  incomplete?: string[];
}

const fmtCompact = (n: number) => {
  if (n >= 1_000_000) return `KES ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `KES ${(n / 1_000).toFixed(0)}K`;
  return formatKES(n);
};

function ComingSoon({ title }: { title: string }) {
  return (
    <Card className="flex flex-col items-center justify-center gap-2 border-dashed py-10 text-center">
      <Clock className="h-6 w-6 text-muted-foreground/50" />
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Coming soon</span>
    </Card>
  );
}

export default function EnterpriseDashboardPage() {
  const { data: dash, isLoading: dashLoading, isError: dashError, error: dashErr } = useQuery<OrgDashboard>({
    queryKey: ['enterprise', 'dashboard'],
    queryFn:  () => adminApi.get('/organization/dashboard'),
  });
  const { data: groupsPage, isLoading: groupsLoading, isError: groupsError, error: groupsErr } = useQuery<PaginatedResult<OrganizationGroupSummary>>({
    queryKey: ['enterprise', 'groups'],
    queryFn:  () => organizationApi.groups(),
  });

  const p = dash?.portfolio;

  // R10 — a figure we could not actually read is shown as a dash, never as 0.
  // "KES 0" is a confident lie here: it is indistinguishable from an
  // organization that genuinely holds nothing, so a coordinator could read a
  // failed query as their groups' money having disappeared.
  const NA = '—';
  const count = (v: number | undefined) => (p && v !== undefined ? v.toLocaleString() : NA);
  const money = (v: string | undefined) => (p && v !== undefined ? fmtCompact(parseFloat(v)) : NA);
  const topGroups = [...(groupsPage?.items ?? [])]
    .sort((a, b) => parseFloat(b.totalContributions) - parseFloat(a.totalContributions))
    .slice(0, 5)
    .map((g) => ({ ...g, id: g.groupId }));

  // UX_UI_OPTIMIZATION_AUDIT_2026-08.md C5: this landing page had zero
  // loading/error handling on its KPI query — first paint and a fetch
  // failure both showed "KES 0" tiles with no signal anything was wrong.
  if (dashLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-16 w-full" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Portfolio Overview"
        description="Performance across all your linked groups"
        actions={<Button variant="outline" size="sm"><Download className="h-4 w-4" /> Export</Button>}
      />

      {dashError && (
        <Alert variant="destructive">
          <AlertCircle size={14} />
          <AlertTitle>Couldn&apos;t load portfolio data</AlertTitle>
          <AlertDescription>
            Figures are shown as &ldquo;{NA}&rdquo; rather than zero, so nothing below is
            mistaken for a real balance. {getErrorMessage(dashErr)}
          </AlertDescription>
        </Alert>
      )}

      {/* Partial failure: the request succeeded but a section could not be read.
          Named explicitly — §1.5's "what needs attention" — rather than letting
          a missing figure pass as a real one. */}
      {!dashError && (dash?.incomplete?.length ?? 0) > 0 && (
        <Alert variant="destructive">
          <AlertCircle size={14} />
          <AlertTitle>Some figures are unavailable</AlertTitle>
          <AlertDescription>
            Couldn&apos;t read: {dash!.incomplete!.join(', ')}. Those figures show
            &ldquo;{NA}&rdquo; instead of a number — they are not zero. Refresh to retry.
          </AlertDescription>
        </Alert>
      )}

      {/* KPI grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard title="Total members" value={count(p?.activeMembers)} icon={Users2} />
        <StatCard title="Total savings" value={money(p?.totalSavings)} icon={PiggyBank} />
        <StatCard title="Loans outstanding" value={money(p?.loanPortfolio)} icon={Landmark} />
        <StatCard title="Active loans" value={count(p?.activeLoans)} icon={Landmark} />
        <StatCard title="Active programs" value={count(p?.activePrograms)} icon={Layers} />
        <StatCard title="Linked groups" value={count(p?.linkedGroups)} icon={Network} />
      </div>

      {/* Charts — no historical-trend or demographic data exists yet */}
      <div className="grid gap-6 lg:grid-cols-3">
        <ComingSoon title="Portfolio growth (savings vs loans, over time)" />
        <ComingSoon title="Savings by region" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <ComingSoon title="Program impact (funder reporting metrics)" />

        {/* Group comparison */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-base">Top groups</CardTitle>
              <p className="text-xs text-muted-foreground">By total contributions</p>
            </div>
            <Link href="/enterprise/branches">
              <Button variant="ghost" size="sm" className="text-xs">All branches <ArrowRight size={12} className="ml-1" /></Button>
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            <PaginatedTable
              data={singlePage(topGroups)}
              isLoading={groupsLoading}
              isError={groupsError}
              error={groupsErr}
              onPageChange={() => {}}
              emptyMessage="No groups yet"
              columns={[
                {
                  key: 'group', header: 'Group',
                  render: (g) => (
                    <>
                      <p className="font-medium text-foreground">{g.groupName}</p>
                      <p className="text-xs text-muted-foreground">{g.county ?? '—'}</p>
                    </>
                  ),
                },
                { key: 'members', header: 'Members', className: 'text-right', render: (g) => <span className="tabular-nums">{g.activeMemberCount.toLocaleString()}</span> },
                { key: 'contributions', header: 'Contributions', className: 'text-right', render: (g) => <MoneyDisplay amount={parseFloat(g.totalContributions)} size="sm" /> },
                {
                  key: 'defaultedLoans', header: 'Defaulted loans', className: 'hidden sm:table-cell text-right',
                  render: (g) => (
                    <span className={`tabular-nums ${g.defaultedLoanCount > 0 ? 'font-medium text-red-600' : 'text-muted-foreground'}`}>{g.defaultedLoanCount}</span>
                  ),
                },
                {
                  key: 'status', header: 'Status',
                  render: (g) => (
                    <StatusPill
                      status={g.defaultedLoanCount > 0 ? 'review' : 'active'}
                      tone={g.defaultedLoanCount > 0 ? 'warning' : 'positive'}
                      label={g.defaultedLoanCount > 0 ? 'review' : 'active'}
                      size="sm"
                    />
                  ),
                },
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
