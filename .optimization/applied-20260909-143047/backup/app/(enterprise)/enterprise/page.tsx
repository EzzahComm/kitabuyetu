'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Users2, PiggyBank, Landmark, Layers, Network, Download, ArrowRight, Clock,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { StatusPill } from '@/components/shared/status-pill';
import { MoneyDisplay } from '@/components/shared/money-display';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PaginatedTable, singlePage } from '@/components/shared/paginated-table';
import { Skeleton } from '@/components/ui/skeleton';
import { organizationApi } from '@/lib/api/endpoints';
import { adminApi } from '@/lib/api/client';
import { formatKES, getErrorMessage } from '@/lib/utils';
import type { OrganizationGroupSummary } from '@/types/api.types';
import type { PaginatedResult } from '@/types/db.types';

interface OrgDashboard {
  portfolio: {
    linkedGroups: number; activeMembers: number; totalSavings: string;
    loanPortfolio: string; activeLoans: number; activePrograms: number;
  };
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
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Couldn&apos;t load portfolio data — figures below may be incomplete. {getErrorMessage(dashErr)}
        </div>
      )}

      {/* KPI grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard title="Total members" value={(p?.activeMembers ?? 0).toLocaleString()} icon={Users2} />
        <StatCard title="Total savings" value={fmtCompact(parseFloat(p?.totalSavings ?? '0'))} icon={PiggyBank} />
        <StatCard title="Loans outstanding" value={fmtCompact(parseFloat(p?.loanPortfolio ?? '0'))} icon={Landmark} />
        <StatCard title="Active loans" value={(p?.activeLoans ?? 0).toLocaleString()} icon={Landmark} />
        <StatCard title="Active programs" value={(p?.activePrograms ?? 0).toLocaleString()} icon={Layers} />
        <StatCard title="Linked groups" value={(p?.linkedGroups ?? 0).toLocaleString()} icon={Network} />
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
