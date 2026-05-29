'use client';

import * as React from 'react';
import { Search, Network, Download } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { StatusPill } from '@/components/shared/status-pill';
import { MoneyDisplay } from '@/components/shared/money-display';
import { Sparkline } from '@/components/shared/charts';
import { EmptyState } from '@/components/ui/empty-state';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { tone } from '@/lib/ui/tokens';
import { branches } from '../../_data';

const branchStatusTone = { active: 'positive', review: 'warning', onboarding: 'info' } as const;

export default function BranchesPage() {
  const [query, setQuery] = React.useState('');
  const [region, setRegion] = React.useState<string>('all');

  const regions = React.useMemo(() => ['all', ...Array.from(new Set(branches.map((b) => b.region)))], []);

  const filtered = branches.filter((b) => {
    const matchesQuery = (b.name + ' ' + b.region).toLowerCase().includes(query.toLowerCase());
    const matchesRegion = region === 'all' || b.region === region;
    return matchesQuery && matchesRegion;
  });

  const totals = filtered.reduce(
    (acc, b) => ({ members: acc.members + b.members, savings: acc.savings + b.savings, loansOut: acc.loansOut + b.loansOut }),
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
          {filtered.length === 0 ? (
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
                    <th className="px-4 py-3 text-right font-medium">PAR</th>
                    <th className="hidden px-4 py-3 font-medium lg:table-cell">6-mo trend</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((b) => (
                    <tr key={b.id} className="border-b transition-colors last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{b.name}</p>
                        <p className="text-xs text-muted-foreground">{b.region}</p>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{b.members.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right"><MoneyDisplay amount={b.savings} size="sm" /></td>
                      <td className="px-4 py-3 text-right"><MoneyDisplay amount={b.loansOut} size="sm" /></td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span className={b.par > 6 ? 'font-semibold text-red-600' : b.par > 4 ? 'text-amber-600' : 'text-muted-foreground'}>{b.par}%</span>
                      </td>
                      <td className="hidden px-4 py-3 lg:table-cell">
                        <div className="w-28"><Sparkline data={b.trend} dataKey="v" height={28} color={tone.positive.solid} /></div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={b.status} tone={branchStatusTone[b.status]} label={b.status} size="sm" />
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
                    <td colSpan={3} />
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
