'use client';

/**
 * Program budget + donor spend reports (ORGANIZATION_LOGIN_ARCHITECTURE_AUDIT.md
 * Phase 4). Both reports already existed server-side
 * (organization-finance.service.ts's programBudgetReport/donorSpendReport,
 * built during the accounting-audit series) — this is the first frontend
 * page for either.
 */
import { useQuery } from '@tanstack/react-query';
import { FileBarChart, TrendingUp, TrendingDown } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { MoneyDisplay } from '@/components/shared/money-display';
import { EmptyState } from '@/components/ui/empty-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { organizationApi } from '@/lib/api/endpoints';

function UtilizationBar({ pct }: { pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  const tone = pct > 100 ? 'bg-red-500' : pct > 85 ? 'bg-amber-500' : 'bg-brand-500';
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className={cn('h-full rounded-full transition-all', tone)} style={{ width: `${clamped}%` }} />
    </div>
  );
}

function BudgetReportTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['enterprise', 'reports', 'budget'],
    queryFn:  () => organizationApi.budgetReport(),
  });
  const items = data?.items ?? [];

  if (isLoading) {
    return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>;
  }
  if (items.length === 0) {
    return (
      <EmptyState
        icon={FileBarChart}
        title="No funding programs yet"
        description="Budget variance appears here once you've created a funding program."
      />
    );
  }

  return (
    <div className="space-y-3">
      {items.map((p) => (
        <Card key={p.id}>
          <CardContent className="space-y-3 py-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium text-foreground">{p.name}</p>
                <p className="text-xs capitalize text-muted-foreground">{p.programType.replace(/_/g, ' ')} · {p.status}</p>
              </div>
              <div className="text-right">
                <MoneyDisplay amount={p.disbursed + p.reserved} size="sm" />
                <p className="text-xs text-muted-foreground">of <MoneyDisplay amount={p.budget} size="sm" className="inline" /> budget</p>
              </div>
            </div>

            <UtilizationBar pct={p.utilizationPct} />

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{p.utilizationPct.toFixed(1)}% utilized · <MoneyDisplay amount={p.remaining} size="sm" className="inline" /> remaining</span>
              {p.variancePct !== null && (
                <span className={cn('flex items-center gap-1 font-medium', p.variancePct < 0 ? 'text-amber-600' : 'text-brand-600')}>
                  {p.variancePct < 0 ? <TrendingDown size={13} /> : <TrendingUp size={13} />}
                  {p.variancePct < 0 ? 'Behind schedule' : 'On/ahead of schedule'} ({p.variancePct > 0 ? '+' : ''}{p.variancePct.toFixed(1)}pp)
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function DonorSpendTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['enterprise', 'reports', 'donor'],
    queryFn:  () => organizationApi.donorSpendReport(),
  });
  const items = data?.items ?? [];

  if (isLoading) {
    return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}</div>;
  }
  if (items.length === 0) {
    return (
      <EmptyState
        icon={FileBarChart}
        title="No donor spend to report yet"
        description="This groups settled disbursements by funding source once your programs start disbursing."
      />
    );
  }

  return (
    <div className="space-y-3">
      {items.map((d) => (
        <Card key={d.fundingSource}>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">{d.fundingSource}</CardTitle>
              <span className="text-xs text-muted-foreground">{d.programCount} program{d.programCount === 1 ? '' : 's'}</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Budget</p>
                <MoneyDisplay amount={d.totalBudget} size="sm" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Disbursed</p>
                <MoneyDisplay amount={d.totalDisbursed} size="sm" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Remaining</p>
                <MoneyDisplay amount={d.remaining} size="sm" />
              </div>
            </div>
            <UtilizationBar pct={d.utilizationPct} />
            {d.byGroup.length > 0 && (
              <div className="border-t pt-3">
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">By branch</p>
                <div className="space-y-1">
                  {d.byGroup.map((g) => (
                    <div key={g.groupId} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{g.groupName ?? 'Unknown branch'}</span>
                      <MoneyDisplay amount={g.amount} size="sm" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Budget variance across your funding programs and spend broken down by donor."
        breadcrumbs={[{ label: 'Portfolio', href: '/enterprise' }, { label: 'Reports' }]}
      />

      <Tabs defaultValue="budget">
        <TabsList>
          <TabsTrigger value="budget">Budget variance</TabsTrigger>
          <TabsTrigger value="donor">Donor spend</TabsTrigger>
        </TabsList>
        <TabsContent value="budget" className="mt-4">
          <BudgetReportTab />
        </TabsContent>
        <TabsContent value="donor" className="mt-4">
          <DonorSpendTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
