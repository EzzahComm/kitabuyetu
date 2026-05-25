'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Clock, Heart, Landmark,
  Loader2, ShieldAlert, UserX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api/client';

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

const TIER_BADGE: Record<HighRiskMember['reliabilityTier'], 'warning' | 'destructive'> = {
  poor:      'warning',
  high_risk: 'destructive',
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
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <Link href="/analytics" className="text-muted-foreground hover:text-foreground mt-1">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ShieldAlert className="h-6 w-6" /> Risk analysis
            </h1>
            <p className="text-sm text-muted-foreground">
              Loans, members and requests that warrant follow-up. Each category caps at 50 most-pressing rows.
            </p>
          </div>
        </div>
      </div>

      {riskQ.isLoading || !r ? (
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
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Member</th>
                      <th className="px-4 py-3 text-right">Principal</th>
                      <th className="px-4 py-3 text-right">Outstanding</th>
                      <th className="px-4 py-3">Due</th>
                      <th className="px-4 py-3 text-right">Days late</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.overdueLoans.map((l) => (
                      <tr key={l.loanId} className="border-b last:border-b-0">
                        <td className="px-4 py-2">
                          <p className="font-medium">{l.firstName} {l.lastName}</p>
                          <p className="font-mono text-xs text-muted-foreground">{l.phone}</p>
                        </td>
                        <td className="px-4 py-2 text-right font-mono">{fmtMoney(l.principalAmount)}</td>
                        <td className="px-4 py-2 text-right font-mono">{fmtMoney(l.outstanding)}</td>
                        <td className="px-4 py-2 font-mono text-xs">{l.nextPaymentDate}</td>
                        <td className={`px-4 py-2 text-right font-mono font-medium ${l.daysOverdue >= 60 ? 'text-red-600' : l.daysOverdue >= 30 ? 'text-amber-600' : ''}`}>
                          {l.daysOverdue}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {r.defaultedLoans.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base text-red-700">
                <Landmark className="h-4 w-4" /> Defaulted &amp; written-off loans ({r.defaultedLoans.length})
              </CardTitle></CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Member</th>
                      <th className="px-4 py-3 text-right">Principal</th>
                      <th className="px-4 py-3 text-right">Outstanding</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.defaultedLoans.map((l) => (
                      <tr key={l.loanId} className="border-b last:border-b-0">
                        <td className="px-4 py-2">
                          <p className="font-medium">{l.firstName} {l.lastName}</p>
                          <p className="font-mono text-xs text-muted-foreground">{l.phone}</p>
                        </td>
                        <td className="px-4 py-2 text-right font-mono">{fmtMoney(l.principalAmount)}</td>
                        <td className="px-4 py-2 text-right font-mono">{fmtMoney(l.outstanding)}</td>
                        <td className="px-4 py-2"><Badge variant="destructive" className="capitalize">{l.status.replace('_', ' ')}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {r.highRiskMembers.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base text-amber-700">
                <ShieldAlert className="h-4 w-4" /> Members in poor or high-risk tier ({r.highRiskMembers.length})
              </CardTitle></CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Member</th>
                      <th className="px-4 py-3 text-right">Overall</th>
                      <th className="px-4 py-3">Tier</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {r.highRiskMembers.map((m) => (
                      <tr key={m.memberId} className="border-b last:border-b-0">
                        <td className="px-4 py-2">
                          <p className="font-medium">{m.firstName} {m.lastName}</p>
                          <p className="font-mono text-xs text-muted-foreground">{m.phone}</p>
                        </td>
                        <td className="px-4 py-2 text-right font-mono font-medium">{m.overallScore.toFixed(0)}</td>
                        <td className="px-4 py-2"><Badge variant={TIER_BADGE[m.reliabilityTier]} className="capitalize">{m.reliabilityTier.replace('_', ' ')}</Badge></td>
                        <td className="px-4 py-2 text-right">
                          <Button asChild size="sm" variant="ghost">
                            <Link href={`/credit-scores/${m.memberId}`}>View score</Link>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {r.idleMembers.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base text-amber-700">
                <UserX className="h-4 w-4" /> Idle members ({r.idleMembers.length})
              </CardTitle></CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Member</th>
                      <th className="px-4 py-3">Joined</th>
                      <th className="px-4 py-3">Last contribution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.idleMembers.map((m) => (
                      <tr key={m.memberId} className="border-b last:border-b-0">
                        <td className="px-4 py-2">
                          <p className="font-medium">{m.firstName} {m.lastName}</p>
                          <p className="font-mono text-xs text-muted-foreground">{m.phone}</p>
                        </td>
                        <td className="px-4 py-2 font-mono text-xs">{m.joinedAt}</td>
                        <td className="px-4 py-2 font-mono text-xs">{m.lastContributionAt ?? <span className="text-muted-foreground italic">never</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {r.staleWelfareRequests.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base text-amber-700">
                <Heart className="h-4 w-4" /> Welfare requests pending &gt; 14 days ({r.staleWelfareRequests.length})
              </CardTitle></CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Member</th>
                      <th className="px-4 py-3 text-right">Requested</th>
                      <th className="px-4 py-3">Submitted</th>
                      <th className="px-4 py-3 text-right">Days pending</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.staleWelfareRequests.map((w) => (
                      <tr key={w.requestId} className="border-b last:border-b-0">
                        <td className="px-4 py-2">
                          <p className="font-medium">{w.firstName} {w.lastName}</p>
                          <p className="font-mono text-xs text-muted-foreground">{w.phone}</p>
                        </td>
                        <td className="px-4 py-2 text-right font-mono">{fmtMoney(w.amountRequested)}</td>
                        <td className="px-4 py-2 font-mono text-xs">{new Date(w.createdAt).toLocaleDateString()}</td>
                        <td className="px-4 py-2 text-right font-mono font-medium">{w.daysPending}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
