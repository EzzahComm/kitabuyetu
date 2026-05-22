'use client';

import Link from 'next/link';
import {
  Users, TrendingUp, Landmark, DollarSign, Heart, Calendar,
  ArrowRight, AlertCircle, CheckCircle2, Clock, BarChart2,
} from 'lucide-react';
import { StatCard } from '@/components/shared/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useMembers } from '@/hooks/use-members';
import { useContributions } from '@/hooks/use-contributions';
import { useLoans } from '@/hooks/use-loans';
import { useWelfareRequests, useWelfarePool } from '@/hooks/use-welfare';
import { useMeetings } from '@/hooks/use-meetings';
import { useInvestmentSummary } from '@/hooks/use-investments';
import { useAuth } from '@/lib/auth/context';
import { formatKES, formatDate } from '@/lib/utils';

function QuickStat({ label, value, sub, color = 'default' }: {
  label: string; value: string | number; sub?: string;
  color?: 'green' | 'red' | 'blue' | 'orange' | 'default';
}) {
  const colorMap = {
    green:   'text-green-600',
    red:     'text-red-600',
    blue:    'text-blue-600',
    orange:  'text-orange-500',
    default: 'text-foreground',
  };
  return (
    <div>
      <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{label}</p>
      <p className={`text-xl font-bold mt-0.5 ${colorMap[color]}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();

  const { data: membersData }       = useMembers({ page: 1, limit: 1 });
  const { data: contributionsData } = useContributions({ page: 1, limit: 5 });
  const { data: loansData }         = useLoans({ page: 1, limit: 5, status: 'active' });
  const { data: pendingLoans }      = useLoans({ page: 1, limit: 5, status: 'pending' });
  const { data: poolData }          = useWelfarePool();
  const { data: pendingWelfare }    = useWelfareRequests({ status: 'pending', limit: 5 });
  const { data: upcomingMeetings }  = useMeetings({ status: 'scheduled', limit: 3 });
  const { data: investSummary }     = useInvestmentSummary();

  const totalMembers    = membersData?.total ?? 0;
  const recentContribs  = (contributionsData?.items ?? []) as any[];
  const activeLoans     = (loansData?.items ?? []) as any[];
  const pendingLoanList = (pendingLoans?.items ?? []) as any[];
  const pendingWelfareList = (pendingWelfare?.items ?? []) as any[];
  const meetingList     = (upcomingMeetings?.items ?? []) as any[];

  const contribTotal = recentContribs.reduce(
    (sum: number, c: any) => sum + parseFloat(c.amount ?? '0'), 0,
  );
  const portfolioTotal = activeLoans.reduce(
    (sum: number, l: any) => sum + parseFloat(l.principal_amount ?? '0'), 0,
  );
  const welfareBalance = poolData?.summary?.balance ?? 0;

  const pendingActions = pendingLoanList.length + pendingWelfareList.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {user ? `Welcome back, ${user.firstName}` : 'Dashboard'}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {user?.groupName} — Financial overview
          </p>
        </div>
        {pendingActions > 0 && (
          <div className="flex items-center gap-2 text-sm text-orange-600 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
            <AlertCircle size={15} />
            <span>{pendingActions} pending action{pendingActions !== 1 ? 's' : ''} need your attention</span>
          </div>
        )}
      </div>

      {/* Primary KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Members"
          value={totalMembers}
          icon={Users}
          description="Active group members"
        />
        <StatCard
          title="Active Loans"
          value={activeLoans.length}
          icon={Landmark}
          description={formatKES(portfolioTotal) + ' portfolio'}
        />
        <StatCard
          title="Contributions (Recent)"
          value={formatKES(contribTotal)}
          icon={TrendingUp}
          description="Last 5 recorded"
        />
        <StatCard
          title="Welfare Fund"
          value={formatKES(welfareBalance)}
          icon={Heart}
          description={`${pendingWelfareList.length} pending requests`}
          iconClass="bg-red-50"
        />
      </div>

      {/* Secondary KPI row */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-5 grid grid-cols-2 gap-4">
            <QuickStat
              label="Pending Loans"
              value={pendingLoanList.length}
              sub="awaiting approval"
              color={pendingLoanList.length > 0 ? 'orange' : 'default'}
            />
            <QuickStat
              label="Investment Portfolio"
              value={formatKES(investSummary?.totalPrincipal ?? 0)}
              sub={`${investSummary?.activeCount ?? 0} active`}
              color="blue"
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 grid grid-cols-2 gap-4">
            <QuickStat
              label="Investment ROI"
              value={`${(investSummary?.roi ?? 0).toFixed(1)}%`}
              sub="overall return"
              color={(investSummary?.roi ?? 0) >= 0 ? 'green' : 'red'}
            />
            <QuickStat
              label="Meetings"
              value={meetingList.length}
              sub="scheduled upcoming"
              color="blue"
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 grid grid-cols-2 gap-4">
            <QuickStat
              label="Welfare Disbursed"
              value={formatKES(poolData?.summary?.totalDisbursed ?? 0)}
              sub="total payouts"
            />
            <QuickStat
              label="Pending Welfare"
              value={pendingWelfareList.length}
              sub="requests to review"
              color={pendingWelfareList.length > 0 ? 'orange' : 'default'}
            />
          </CardContent>
        </Card>
      </div>

      {/* Main content grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent contributions */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Recent Contributions</CardTitle>
              <Link href="/contributions">
                <Button variant="ghost" size="sm" className="text-xs h-7 gap-1">
                  View all <ArrowRight size={12} />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {recentContribs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No contributions yet</p>
            ) : (
              <div className="space-y-3">
                {recentContribs.map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between text-sm">
                    <div>
                      <p className="font-medium">{c.member_name ?? c.memberName ?? c.member_id}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(c.created_at ?? c.createdAt)}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-green-600">{formatKES(c.amount)}</p>
                      <Badge variant={c.status === 'completed' ? 'success' : 'warning'} className="text-xs">
                        {c.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Active loans */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Active Loans</CardTitle>
              <Link href="/loans">
                <Button variant="ghost" size="sm" className="text-xs h-7 gap-1">
                  View all <ArrowRight size={12} />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {activeLoans.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No active loans</p>
            ) : (
              <div className="space-y-3">
                {activeLoans.map((l: any) => (
                  <div key={l.id} className="flex items-center justify-between text-sm">
                    <div>
                      <p className="font-medium">{l.member_name ?? l.memberName ?? l.member_id}</p>
                      <p className="text-xs text-muted-foreground">
                        {l.loan_term_months ?? l.loanTermMonths}m @ {l.interest_rate ?? l.interestRate}%
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{formatKES(l.principal_amount ?? l.principalAmount)}</p>
                      <p className="text-xs text-muted-foreground">
                        Balance: {formatKES(l.outstanding_balance ?? l.outstandingBalance ?? l.principal_amount ?? l.principalAmount)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Upcoming meetings */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar size={15} /> Upcoming Meetings
              </CardTitle>
              <Link href="/meetings">
                <Button variant="ghost" size="sm" className="text-xs h-7 gap-1">
                  View all <ArrowRight size={12} />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {meetingList.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No upcoming meetings scheduled</p>
            ) : (
              <div className="space-y-3">
                {meetingList.map((m: any) => (
                  <div key={m.id} className="flex items-start gap-3 text-sm">
                    <div className="rounded-lg bg-blue-50 p-2 shrink-0">
                      <Calendar size={14} className="text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{m.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(m.scheduled_at)} · {new Date(m.scheduled_at).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                      {m.venue && <p className="text-xs text-muted-foreground">{m.venue}</p>}
                    </div>
                    <Badge variant="warning" className="text-xs shrink-0">
                      {m.meeting_type}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pending actions */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertCircle size={15} className="text-orange-500" /> Pending Actions
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pendingActions === 0 ? (
              <div className="flex flex-col items-center py-6 gap-2 text-center">
                <CheckCircle2 size={24} className="text-green-500" />
                <p className="text-sm text-muted-foreground">All clear — no pending actions</p>
              </div>
            ) : (
              <div className="space-y-3">
                {pendingLoanList.length > 0 && (
                  <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Landmark size={14} className="text-orange-600" />
                        <p className="text-sm font-medium text-orange-800">
                          {pendingLoanList.length} Loan{pendingLoanList.length !== 1 ? 's' : ''} awaiting approval
                        </p>
                      </div>
                      <Link href="/loans">
                        <Button size="sm" variant="outline" className="h-7 text-xs border-orange-300">
                          Review
                        </Button>
                      </Link>
                    </div>
                    <div className="mt-2 space-y-1">
                      {pendingLoanList.slice(0, 2).map((l: any) => (
                        <p key={l.id} className="text-xs text-orange-700">
                          {l.member_name ?? l.memberName} — {formatKES(l.principal_amount ?? l.principalAmount)}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
                {pendingWelfareList.length > 0 && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Heart size={14} className="text-red-600" />
                        <p className="text-sm font-medium text-red-800">
                          {pendingWelfareList.length} Welfare request{pendingWelfareList.length !== 1 ? 's' : ''} to review
                        </p>
                      </div>
                      <Link href="/welfare">
                        <Button size="sm" variant="outline" className="h-7 text-xs border-red-300">
                          Review
                        </Button>
                      </Link>
                    </div>
                    <div className="mt-2 space-y-1">
                      {pendingWelfareList.slice(0, 2).map((w: any) => (
                        <p key={w.id} className="text-xs text-red-700">
                          {w.member_name} — {w.title} ({formatKES(w.amount_requested)})
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick links */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {[
              { label: 'Record Contribution', href: '/contributions' },
              { label: 'Apply for Loan', href: '/loans' },
              { label: 'Submit Welfare Request', href: '/welfare' },
              { label: 'Schedule Meeting', href: '/meetings' },
              { label: 'Add Investment', href: '/investments' },
              { label: 'Add Member', href: '/members' },
              { label: 'View Reports', href: '/reports' },
              { label: 'M-Pesa Treasury', href: '/treasury' },
            ].map(({ label, href }) => (
              <Link key={href} href={href}>
                <Button variant="outline" size="sm" className="text-xs h-8">
                  {label}
                </Button>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
