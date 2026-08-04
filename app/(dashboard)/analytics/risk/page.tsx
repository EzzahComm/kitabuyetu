'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Clock, Heart, Landmark,
  Loader2, ShieldAlert, UserX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusPill } from '@/components/shared/status-pill';
import { PageHeader } from '@/components/shared/page-header';
import { PaginatedTable, singlePage } from '@/components/shared/paginated-table';
import { api } from '@/lib/api/client';
import { getErrorMessage } from '@/lib/utils';
import type { Tone } from '@/lib/ui/tokens';

interface OverdueLoan {
  loanId: string; memberId: string; firstName: string; lastName: string;
  phone: string; principalAmount: string; outstanding: string;
  nextPaymentDate: string; daysOverdue: number;
}
interface DefaultedLoan {
  loanId: string; memberId: string; firstName: string; lastName: string;
  phone: string; principalAmount: string; outstanding: string; status: string;
}
interface HighRiskMember {
  memberId: string; firstName: string; lastName: string; phone: string;
  overallScore: number; reliabilityTier: 'poor' | 'high_risk';
}
interface IdleMember {
  memberId: string; firstName: string; lastName: string; phone: string;
  joinedAt: string; lastContributionAt: string | null;
}
interface StaleWelfare {
  requestId: string; memberId: string; firstName: string; lastName: string;
  phone: string; amountRequested: string; createdAt: string; daysPending: number;
}
interface RiskAnalysis {
  generatedAt: string;
  overdueLoans: OverdueLoan[];
  defaultedLoans: DefaultedLoan[];
  highRiskMembers: HighRiskMember[];
  idleMembers: IdleMember[];
  staleWelfareRequests: StaleWelfare[];
}

const fmtMoney = (v: string | number | null | undefined) =>
  new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(Number(v ?? 0));

// Same reliability-tier → tone mapping as credit-scores/page.tsx and
// credit-scores/[memberId]/page.tsx, for consistency across all three.
const TIER_TONE: Record<HighRiskMember['reliabilityTier'], Tone> = {
  poor:      'negative',
  high_risk: 'negative',
};

export default function RiskAnalysisPage() {
  const riskQ = useQuery<RiskAnalysis>({
    queryKey: ['analytics', 'risk'],
    queryFn:  () => api.get<RiskAnalysis>('/analytics/risk'),
  });
  const r = riskQ.data;

  const totalRisks =
    (r?.overdueLoans.length ?? 0) +
    (r?.defaultedLoans.length ?? 0) +
    (r?.highRiskMembers.length ?? 0) +
    (r?.idleMembers.length ?? 0) +
    (r?.staleWelfareRequests.length ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <Link href="/analytics" className="text-muted-foreground hover:text-foreground mt-1">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <PageHeader
          className="flex-1"
          title="Risk analysis"
          description="Loans, members and requests that warrant follow-up. Each category caps at 50 most-pressing rows."
        />
      </div>

      {riskQ.isError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Couldn&apos;t load risk data. {getErrorMessage(riskQ.error)}
        </div>
      ) : riskQ.isLoading || !r ? (
        <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <>
          {/* Summary tiles */}
          <div className="grid gap-3 md:grid-cols-5">
            <RiskTile icon={<Clock     className="h-4 w-4" />} label="Overdue loans"   value={r.overdueLoans.length}        tone={r.overdueLoans.length > 0 ? 'warning' : 'ok'} />
            <RiskTile icon={<Landmark  className="h-4 w-4" />} label="Defaulted loans" value={r.defaultedLoans.length}      tone={r.defaultedLoans.length > 0 ? 'danger' : 'ok'} />
            <RiskTile icon={<ShieldAlert className="h-4 w-4" />} label="Risky members" value={r.highRiskMembers.length}     tone={r.highRiskMembers.length > 0 ? 'warning' : 'ok'} />
            <RiskTile icon={<UserX     className="h-4 w-4" />} label="Idle members"   value={r.idleMembers.length}         tone={r.idleMembers.length > 0 ? 'warning' : 'ok'} />
            <RiskTile icon={<Heart     className="h-4 w-4" />} label="Stale welfare"  value={r.staleWelfareRequests.length} tone={r.staleWelfareRequests.length > 0 ? 'warning' : 'ok'} />
          </div>

          {totalRisks === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                <CheckCircle2 className="h-10 w-10 text-green-600" />
                <p className="font-medium">No risk signals right now</p>
                <p className="max-w-md text-sm text-muted-foreground">
                  Every loan is on schedule, no members are in poor or high-risk credit tiers,
                  contributions are active, and pending welfare requests are fresh.
                </p>
              </CardContent>
            </Card>
          )}

          {r.overdueLoans.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base text-amber-700">
                <Clock className="h-4 w-4" /> Overdue loans ({r.overdueLoans.length})
              </CardTitle></CardHeader>
              <CardContent className="p-0">
                <PaginatedTable
                  data={singlePage(r.overdueLoans.map((l) => ({ ...l, id: l.loanId })))}
                  isLoading={false}
                  onPageChange={() => {}}
                  emptyMessage="No overdue loans"
                  columns={[
                    {
                      key: 'member', header: 'Member', render: (l) => (
                        <>
                          <p className="font-medium">{l.firstName} {l.lastName}</p>
                          <p className="font-mono text-xs text-muted-foreground">{l.phone}</p>
                        </>
                      ),
                    },
                    { key: 'principal', header: 'Principal', className: 'text-right', render: (l) => <span className="font-mono">{fmtMoney(l.principalAmount)}</span> },
                    { key: 'outstanding', header: 'Outstanding', className: 'text-right', render: (l) => <span className="font-mono">{fmtMoney(l.outstanding)}</span> },
                    { key: 'due', header: 'Due', render: (l) => <span className="font-mono text-xs">{l.nextPaymentDate}</span> },
                    {
                      key: 'daysOverdue', header: 'Days late', className: 'text-right', render: (l) => (
                        <span className={`font-mono font-medium ${l.daysOverdue >= 60 ? 'text-red-600' : l.daysOverdue >= 30 ? 'text-amber-600' : ''}`}>
                          {l.daysOverdue}
                        </span>
                      ),
                    },
                  ]}
                />
              </CardContent>
            </Card>
          )}

          {r.defaultedLoans.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base text-red-700">
                <Landmark className="h-4 w-4" /> Defaulted &amp; written-off loans ({r.defaultedLoans.length})
              </CardTitle></CardHeader>
              <CardContent className="p-0">
                <PaginatedTable
                  data={singlePage(r.defaultedLoans.map((l) => ({ ...l, id: l.loanId })))}
                  isLoading={false}
                  onPageChange={() => {}}
                  emptyMessage="No defaulted loans"
                  columns={[
                    {
                      key: 'member', header: 'Member', render: (l) => (
                        <>
                          <p className="font-medium">{l.firstName} {l.lastName}</p>
                          <p className="font-mono text-xs text-muted-foreground">{l.phone}</p>
                        </>
                      ),
                    },
                    { key: 'principal', header: 'Principal', className: 'text-right', render: (l) => <span className="font-mono">{fmtMoney(l.principalAmount)}</span> },
                    { key: 'outstanding', header: 'Outstanding', className: 'text-right', render: (l) => <span className="font-mono">{fmtMoney(l.outstanding)}</span> },
                    { key: 'status', header: 'Status', render: (l) => <StatusPill status={l.status} tone="negative" /> },
                  ]}
                />
              </CardContent>
            </Card>
          )}

          {r.highRiskMembers.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base text-amber-700">
                <ShieldAlert className="h-4 w-4" /> Members in poor or high-risk tier ({r.highRiskMembers.length})
              </CardTitle></CardHeader>
              <CardContent className="p-0">
                <PaginatedTable
                  data={singlePage(r.highRiskMembers.map((m) => ({ ...m, id: m.memberId })))}
                  isLoading={false}
                  onPageChange={() => {}}
                  emptyMessage="No high-risk members"
                  columns={[
                    {
                      key: 'member', header: 'Member', render: (m) => (
                        <>
                          <p className="font-medium">{m.firstName} {m.lastName}</p>
                          <p className="font-mono text-xs text-muted-foreground">{m.phone}</p>
                        </>
                      ),
                    },
                    { key: 'overall', header: 'Overall', className: 'text-right', render: (m) => <span className="font-mono font-medium">{m.overallScore.toFixed(0)}</span> },
                    { key: 'tier', header: 'Tier', render: (m) => <StatusPill status={m.reliabilityTier} tone={TIER_TONE[m.reliabilityTier]} /> },
                    {
                      key: 'actions', header: '', className: 'text-right', render: (m) => (
                        <Button asChild size="sm" variant="ghost">
                          <Link href={`/credit-scores/${m.memberId}`}>View score</Link>
                        </Button>
                      ),
                    },
                  ]}
                />
              </CardContent>
            </Card>
          )}

          {r.idleMembers.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base text-amber-700">
                <UserX className="h-4 w-4" /> Idle members ({r.idleMembers.length})
              </CardTitle></CardHeader>
              <CardContent className="p-0">
                <PaginatedTable
                  data={singlePage(r.idleMembers.map((m) => ({ ...m, id: m.memberId })))}
                  isLoading={false}
                  onPageChange={() => {}}
                  emptyMessage="No idle members"
                  columns={[
                    {
                      key: 'member', header: 'Member', render: (m) => (
                        <>
                          <p className="font-medium">{m.firstName} {m.lastName}</p>
                          <p className="font-mono text-xs text-muted-foreground">{m.phone}</p>
                        </>
                      ),
                    },
                    { key: 'joinedAt', header: 'Joined', render: (m) => <span className="font-mono text-xs">{m.joinedAt}</span> },
                    { key: 'lastContributionAt', header: 'Last contribution', render: (m) => <span className="font-mono text-xs">{m.lastContributionAt ?? <span className="text-muted-foreground italic">never</span>}</span> },
                  ]}
                />
              </CardContent>
            </Card>
          )}

          {r.staleWelfareRequests.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base text-amber-700">
                <Heart className="h-4 w-4" /> Welfare requests pending &gt; 14 days ({r.staleWelfareRequests.length})
              </CardTitle></CardHeader>
              <CardContent className="p-0">
                <PaginatedTable
                  data={singlePage(r.staleWelfareRequests.map((w) => ({ ...w, id: w.requestId })))}
                  isLoading={false}
                  onPageChange={() => {}}
                  emptyMessage="No stale welfare requests"
                  columns={[
                    {
                      key: 'member', header: 'Member', render: (w) => (
                        <>
                          <p className="font-medium">{w.firstName} {w.lastName}</p>
                          <p className="font-mono text-xs text-muted-foreground">{w.phone}</p>
                        </>
                      ),
                    },
                    { key: 'amountRequested', header: 'Requested', className: 'text-right', render: (w) => <span className="font-mono">{fmtMoney(w.amountRequested)}</span> },
                    { key: 'createdAt', header: 'Submitted', render: (w) => <span className="font-mono text-xs">{new Date(w.createdAt).toLocaleDateString()}</span> },
                    { key: 'daysPending', header: 'Days pending', className: 'text-right', render: (w) => <span className="font-mono font-medium">{w.daysPending}</span> },
                  ]}
                />
              </CardContent>
            </Card>
          )}

          <p className="text-xs text-muted-foreground">
            Generated {new Date(r.generatedAt).toLocaleString()}
          </p>
        </>
      )}
    </div>
  );
}

function RiskTile({ icon, label, value, tone }: {
  icon: React.ReactNode; label: string; value: number;
  tone: 'ok' | 'warning' | 'danger';
}) {
  const valueClass = tone === 'danger' ? 'text-red-600' : tone === 'warning' ? 'text-amber-600' : 'text-green-600';
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'danger' ? AlertTriangle : Clock;
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase text-muted-foreground">{label}</p>
          <span className="text-muted-foreground">{icon}</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <p className={`text-2xl font-semibold ${valueClass}`}>{value}</p>
          <Icon className={`h-4 w-4 ${valueClass}`} />
        </div>
      </CardContent>
    </Card>
  );
}
