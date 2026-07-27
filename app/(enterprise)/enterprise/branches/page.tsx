'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Network, Download } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { StatusPill } from '@/components/shared/status-pill';
import { MoneyDisplay } from '@/components/shared/money-display';
import { EmptyState } from '@/components/ui/empty-state';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { organizationApi } from '@/lib/api/endpoints';
import type { OrganizationGroupSummary } from '@/types/api.types';
import type { PaginatedResult } from '@/types/db.types';

export default function BranchesPage() {
  const [query, setQuery] = React.useState('');
  const [region, setRegion] = React.useState<string>('all');

  const { data: groupsPage, isLoading } = useQuery<PaginatedResult<OrganizationGroupSummary>>({
    queryKey: ['enterprise', 'groups'],
    queryFn:  () => organizationApi.groups(),
  });

  const groups = groupsPage?.items;
  const rows = groups ?? [];
  const regions = React.useMemo(
    () => ['all', ...Array.from(new Set((groups ?? []).map((g) => g.county).filter((c): c is string => !!c)))],
    [groups],
  );

  const filtered = rows.filter((g) => {
    const matchesQuery = (g.groupName + ' ' + (g.county ?? '')).toLowerCase().includes(query.toLowerCase());
    const matchesRegion = region === 'all' || g.county === region;
    return matchesQuery && matchesRegion;
  });

  const totals = filtered.reduce(
    (acc, g) => ({
      members: acc.members + g.activeMemberCount,
      savings: acc.savings + parseFloat(g.totalContributions),
      loansOut: acc.loansOut + parseFloat(g.activeLoanPortfolio),
    }),
    { members: 0, savings: 0, loansOut: 0 },
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Branches"
        description="Multi-branch financial visibility and comparative performance"
        breadcrumbs={[{ label: 'Portfolio', href: '/enterprise' }, { label: 'Branches' }]}
        actions={<Button variant="outline" size="sm"><Download className="h-4 w-4" /> Export CSV</Button>}
      />

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative max-w-xs flex-1">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search branches…" className="pl-8" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {regions.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRegion(r)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors',
                region === r ? 'bg-brand-600 text-white' : 'bg-muted text-muted-foreground hover:bg-muted/70',
              )}
            >
              {r === 'all' ? 'All regions' : r}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Network}
              title="No branches match"
              description="Try a different search term or clear the region filter."
              action={<Button variant="outline" onClick={() => { setQuery(''); setRegion('all'); }}>Clear filters</Button>}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Branch</th>
                    <th className="px-4 py-3 text-right font-medium">Members</th>
                    <th className="px-4 py-3 text-right font-medium">Savings</th>
                    <th className="px-4 py-3 text-right font-medium">Loans out</th>
                    <th className="px-4 py-3 text-right font-medium">Defaulted loans</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((g) => (
                    <tr key={g.groupId} className="border-b transition-colors last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{g.groupName}</p>
                        <p className="text-xs text-muted-foreground">{g.county ?? '—'}</p>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{g.activeMemberCount.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right"><MoneyDisplay amount={parseFloat(g.totalContributions)} size="sm" /></td>
                      <td className="px-4 py-3 text-right"><MoneyDisplay amount={parseFloat(g.activeLoanPortfolio)} size="sm" /></td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span className={g.defaultedLoanCount > 0 ? 'font-semibold text-red-600' : 'text-muted-foreground'}>{g.defaultedLoanCount}</span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill
                          status={g.defaultedLoanCount > 0 ? 'review' : 'active'}
                          tone={g.defaultedLoanCount > 0 ? 'warning' : 'positive'}
                          label={g.defaultedLoanCount > 0 ? 'review' : 'active'}
                          size="sm"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/40 font-medium">
                    <td className="px-4 py-3 text-xs uppercase tracking-wide text-muted-foreground">{filtered.length} branches</td>
                    <td className="px-4 py-3 text-right tabular-nums">{totals.members.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right"><MoneyDisplay amount={totals.savings} size="sm" /></td>
                    <td className="px-4 py-3 text-right"><MoneyDisplay amount={totals.loansOut} size="sm" /></td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
