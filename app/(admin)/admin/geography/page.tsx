'use client';

import { Fragment, useMemo, useState } from 'react';
import { ChevronRight, ChevronDown, MapPin, ArrowUpDown } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { useCountyGeography, useWardGeography } from '@/hooks/use-admin';
import { formatKES } from '@/lib/utils';

interface CountyRow {
  county_id:          string;
  county_name:        string;
  region:             string | null;
  group_count:        string;
  member_count:       string;
  total_contributions: string;
  loan_book:          string;
}

interface WardRow {
  ward:               string;
  group_count:        string;
  member_count:       string;
  total_contributions: string;
}

type SortKey = 'county_name' | 'group_count' | 'member_count' | 'total_contributions' | 'loan_book';

function WardBreakdown({ countyId }: { countyId: string }) {
  const { data, isLoading } = useWardGeography(countyId, true);
  const wards: WardRow[] = data ?? [];

  if (isLoading) {
    return <div className="p-3 space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}</div>;
  }
  if (wards.length === 0) {
    return <p className="p-3 text-xs text-muted-foreground">No groups recorded for this county yet.</p>;
  }
  return (
    <div className="px-3 pb-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="h-8 text-xs">Ward</TableHead>
            <TableHead className="h-8 text-xs text-right">Groups</TableHead>
            <TableHead className="h-8 text-xs text-right">Member Reach</TableHead>
            <TableHead className="h-8 text-xs text-right">Contributions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {wards.map((w) => (
            <TableRow key={w.ward} className="hover:bg-transparent">
              <TableCell className="py-1.5 text-sm text-gray-700">{w.ward}</TableCell>
              <TableCell className="py-1.5 text-right text-sm">{w.group_count}</TableCell>
              <TableCell className="py-1.5 text-right text-sm">{Number(w.member_count).toLocaleString()}</TableCell>
              <TableCell className="py-1.5 text-right text-sm text-green-600">{formatKES(w.total_contributions)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SortHeader({
  label, sortKey, active, dir, onSort, className,
}: {
  label: string; sortKey: SortKey; active: boolean; dir: 'asc' | 'desc';
  onSort: (key: SortKey) => void; className?: string;
}) {
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {label}
        <ArrowUpDown size={11} className={active ? 'text-foreground' : 'text-gray-300'} />
        {active && <span className="text-[10px]">{dir === 'asc' ? '↑' : '↓'}</span>}
      </button>
    </TableHead>
  );
}

export default function GeographyPage() {
  const { data, isLoading } = useCountyGeography();
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'group_count', dir: 'desc' });
  const [expanded, setExpanded] = useState<string | null>(null);

  const rows: CountyRow[] = useMemo(() => data ?? [], [data]);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const key = sort.key;
      const av = key === 'county_name' ? a[key] : Number(a[key]);
      const bv = key === 'county_name' ? b[key] : Number(b[key]);
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [rows, sort]);

  const totals = rows.reduce(
    (acc, r) => ({
      counties: acc.counties + (Number(r.group_count) > 0 ? 1 : 0),
      groups:   acc.groups + Number(r.group_count),
      members:  acc.members + Number(r.member_count),
    }),
    { counties: 0, groups: 0, members: 0 },
  );

  const handleSort = (key: SortKey) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }));
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Geography"
        description="County and ward-level reach across the platform's jurisdiction hierarchy"
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title="Counties with groups" value={`${totals.counties} / ${rows.length || 47}`} icon={MapPin} />
        <StatCard title="Total groups"  value={totals.groups} />
        <StatCard title="Total member reach" value={totals.members.toLocaleString()} />
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-12 text-center">
              <MapPin className="mx-auto h-8 w-8 text-gray-300 mb-3" />
              <p className="text-sm font-medium text-gray-900">No jurisdiction data available</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <SortHeader label="County" sortKey="county_name" active={sort.key === 'county_name'} dir={sort.dir} onSort={handleSort} />
                  <TableHead>Region</TableHead>
                  <SortHeader label="Groups" sortKey="group_count" active={sort.key === 'group_count'} dir={sort.dir} onSort={handleSort} className="text-right" />
                  <SortHeader label="Member Reach" sortKey="member_count" active={sort.key === 'member_count'} dir={sort.dir} onSort={handleSort} className="text-right" />
                  <SortHeader label="Contributions" sortKey="total_contributions" active={sort.key === 'total_contributions'} dir={sort.dir} onSort={handleSort} className="text-right" />
                  <SortHeader label="Loan Book" sortKey="loan_book" active={sort.key === 'loan_book'} dir={sort.dir} onSort={handleSort} className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((county) => {
                  const isOpen = expanded === county.county_id;
                  return (
                    <Fragment key={county.county_id}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() => setExpanded(isOpen ? null : county.county_id)}
                      >
                        <TableCell className="text-gray-400">
                          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </TableCell>
                        <TableCell className="font-medium text-gray-900">{county.county_name}</TableCell>
                        <TableCell className="text-gray-600">{county.region ?? '—'}</TableCell>
                        <TableCell className="text-right font-medium">{county.group_count}</TableCell>
                        <TableCell className="text-right font-medium">{Number(county.member_count).toLocaleString()}</TableCell>
                        <TableCell className="text-right text-green-600 font-medium">{formatKES(county.total_contributions)}</TableCell>
                        <TableCell className="text-right text-gray-600">{formatKES(county.loan_book)}</TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={7} className="p-0 bg-gray-50/50">
                            <WardBreakdown countyId={county.county_id} />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
