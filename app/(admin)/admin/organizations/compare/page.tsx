'use client';

import { useRouter } from 'next/navigation';
import { Landmark, Users, Layers } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { useOrganizationComparison } from '@/hooks/use-admin';
import { formatKES } from '@/lib/utils';

interface OrgComparisonRow {
  id:               string;
  name:             string;
  type:             string;
  county:           string | null;
  is_active:        boolean;
  group_count:      string;
  member_reach:     string;
  wallet_balance:   string;
  total_disbursed:  string;
  avg_health_score: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  bank: 'Bank', sacco: 'SACCO', foundation: 'Foundation', ngo: 'NGO',
  government: 'Government', cooperative: 'Cooperative', faith_based: 'Faith-based', other: 'Other',
};

// Same derived-band thresholds the governance engine uses to score a metric
// (green=100/amber=55/red=15) collapsed into ranges — this is a display
// banding over an already-averaged cross-group score, not a stored RAG value.
function healthBand(score: number) {
  if (score >= 80) return { label: 'Strong', className: 'text-green-600 bg-green-50' };
  if (score >= 50) return { label: 'Watch', className: 'text-amber-600 bg-amber-50' };
  return { label: 'At risk', className: 'text-red-600 bg-red-50' };
}

export default function OrganizationsComparePage() {
  const router = useRouter();
  const { data, isLoading } = useOrganizationComparison();
  const rows: OrgComparisonRow[] = data ?? [];

  const totals = rows.reduce(
    (acc, r) => ({
      groups:    acc.groups + Number(r.group_count),
      members:   acc.members + Number(r.member_reach),
      wallet:    acc.wallet + Number(r.wallet_balance),
    }),
    { groups: 0, members: 0, wallet: 0 },
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Compare organizations"
        description="Side-by-side reach, wallet, and governance health across every active organization"
        breadcrumbs={[
          { label: 'Organizations', href: '/admin/organizations' },
          { label: 'Compare' },
        ]}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title="Organizations" value={rows.length} icon={Landmark} />
        <StatCard title="Combined groups"  value={totals.groups} icon={Layers} />
        <StatCard title="Combined member reach" value={totals.members.toLocaleString()} icon={Users} />
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-12 text-center">
              <Landmark className="mx-auto h-8 w-8 text-gray-300 mb-3" />
              <p className="text-sm font-medium text-gray-900">No active organizations yet</p>
              <p className="text-xs text-muted-foreground mt-1">Onboard an organization to see it here.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead>County</TableHead>
                  <TableHead className="text-right">Groups</TableHead>
                  <TableHead className="text-right">Member Reach</TableHead>
                  <TableHead className="text-right">Wallet</TableHead>
                  <TableHead className="text-right">Disbursed</TableHead>
                  <TableHead className="text-right">Avg. Health</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((org) => {
                  const score = org.avg_health_score !== null ? Number(org.avg_health_score) : null;
                  const band  = score !== null ? healthBand(score) : null;
                  return (
                    <TableRow
                      key={org.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/admin/organizations/${org.id}`)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                            <Landmark size={13} className="text-blue-600" />
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{org.name}</p>
                            <p className="text-xs text-gray-400">{TYPE_LABEL[org.type] ?? org.type}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-gray-600">{org.county ?? '—'}</TableCell>
                      <TableCell className="text-right font-medium">{org.group_count}</TableCell>
                      <TableCell className="text-right font-medium">{Number(org.member_reach).toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <span className="text-green-600 font-medium">{formatKES(org.wallet_balance)}</span>
                      </TableCell>
                      <TableCell className="text-right text-gray-600">{formatKES(org.total_disbursed)}</TableCell>
                      <TableCell className="text-right">
                        {band ? (
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${band.className}`}>
                            {band.label} {score}
                          </span>
                        ) : (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-400">
                            Not yet scored
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
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
