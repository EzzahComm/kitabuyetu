'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Users, Heart, ArrowRight, AlertCircle, CheckCircle2,
  Landmark, ReceiptText, UserX, Wallet, Smartphone, Plus,
  PiggyBank, TrendingDown, CalendarClock, HandCoins, UserPlus,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/shared/status-pill';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { Button } from '@/components/ui/button';
import { QuickActions, type QuickAction } from '@/components/shared/quick-actions';
import { useMembers } from '@/hooks/use-members';
import { useContributions } from '@/hooks/use-contributions';
import { useLoans } from '@/hooks/use-loans';
import { useWelfareRequests, useWelfarePool } from '@/hooks/use-welfare';
import { useAuth, isTenantUser } from '@/lib/auth/context';
import { api } from '@/lib/api/client';
import { loansApi } from '@/lib/api/endpoints';
import { formatKES, formatDate, getErrorMessage } from '@/lib/utils';
import { StkPromptDialog } from '@/components/mpesa/stk-prompt-dialog';
import type { LoanRepayment } from '@/types/db.types';

interface TaskRowProps {
  icon: React.ElementType;
  tone: 'orange' | 'red' | 'blue' | 'amber';
  count: number;
  label: string;
  preview?: string[];
  href: string;
  cta: string;
}

const toneMap = {
  orange: { border: 'border-orange-200', bg: 'bg-orange-50', icon: 'text-orange-600', text: 'text-orange-800', sub: 'text-orange-700', btn: 'border-orange-300' },
  red:    { border: 'border-red-200',    bg: 'bg-red-50',    icon: 'text-red-600',    text: 'text-red-800',    sub: 'text-red-700',    btn: 'border-red-300' },
  blue:   { border: 'border-blue-200',   bg: 'bg-blue-50',   icon: 'text-blue-600',   text: 'text-blue-800',   sub: 'text-blue-700',   btn: 'border-blue-300' },
  amber:  { border: 'border-amber-200',  bg: 'bg-amber-50',  icon: 'text-amber-600',  text: 'text-amber-800',  sub: 'text-amber-700',  btn: 'border-amber-300' },
} as const;

function TaskRow({ icon: Icon, tone, count, label, preview, href, cta }: TaskRowProps) {
  const c = toneMap[tone];
  return (
    <div className={`rounded-lg border ${c.border} ${c.bg} p-3`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Icon size={15} className={c.icon} />
          <p className={`text-sm font-medium ${c.text} truncate`}>
            <span className="font-bold">{count}</span> {label}
          </p>
        </div>
        <Link href={href}>
          <Button size="sm" variant="outline" className={`h-7 text-xs ${c.btn} shrink-0`}>
            {cta}
          </Button>
        </Link>
      </div>
      {preview && preview.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {preview.slice(0, 3).map((p, i) => (
            <p key={i} className={`text-xs ${c.sub} truncate`}>{p}</p>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [stkOpen, setStkOpen] = useState(false);

  const { data: membersData, isLoading: loadingMembers, isError: errMembers, error: membersErr }             = useMembers({ page: 1, limit: 1 });
  const { data: contributionsData, isLoading: loadingContribs, isError: errContribs, error: contribsErr }     = useContributions({ page: 1, limit: 5 });
  const { data: pendingLoans, isLoading: loadingPendingLoans, isError: errPendingLoans, error: pendingLoansErr } = useLoans({ page: 1, limit: 5, status: 'pending' });
  const { data: poolData, isLoading: loadingPool, isError: errPool, error: poolErr }                           = useWelfarePool();
  const { data: pendingWelfare, isLoading: loadingWelfare, isError: errWelfare, error: welfareErr }            = useWelfareRequests({ status: 'pending', limit: 5 });

  const { data: unrouted, isLoading: loadingUnrouted, isError: errUnrouted, error: unroutedErr } = useQuery<{ items: { id: string; amount?: string; phone?: string; receipt?: string }[] }>({
    queryKey: ['dashboard', 'mpesa-unrouted'],
    queryFn:  () => api.get('/mpesa/unrouted'),
    staleTime: 30_000,
  });

  const { data: nonContrib, isLoading: loadingNonContrib, isError: errNonContrib, error: nonContribErr } = useQuery<{ count: number; sample: { id: string; name: string }[] }>({
    queryKey: ['dashboard', 'non-contributors'],
    queryFn:  () => api.get('/contributions/non-contributors'),
    staleTime: 60_000,
  });

  const { data: trialBalance, isLoading: loadingTrialBalance, isError: errTrialBalance, error: trialBalanceErr } = useQuery<{ accountCode: string; netBalance: string }[]>({
    queryKey: ['dashboard', 'trial-balance'],
    queryFn:  () => api.get('/accounting/reports?type=trial_balance'),
    staleTime: 60_000,
  });

  // Total Savings / Outstanding Loans / This Month's Contributions — all
  // three already computed by the executive-analytics endpoint (built for
  // /analytics), just not previously surfaced on the dashboard.
  const { data: execSummary, isLoading: loadingExecSummary, isError: errExecSummary, error: execSummaryErr } = useQuery<{
    contributions: { totalAmount: string; monthlyBuckets: { bucket: string; amount: string }[] };
    loans: { outstandingBalance: string };
  }>({
    queryKey: ['dashboard', 'executive-summary'],
    queryFn:  () => api.get('/analytics/executive?period=12mo'),
    staleTime: 60_000,
  });

  const { data: upcomingRepayments, isLoading: loadingUpcoming, isError: errUpcoming, error: upcomingErr } = useQuery<(LoanRepayment & { member_name: string })[]>({
    queryKey: ['dashboard', 'upcoming-repayments'],
    queryFn:  () => loansApi.upcomingRepayments(5),
    staleTime: 60_000,
  });

  // UX_UI_OPTIMIZATION_AUDIT_2026-08.md C5: this page previously had zero
  // loading/error handling across any of its 9 independent queries — the
  // initial fetch and a total fetch failure both rendered an identical
  // confident "All clear," "No contributions yet," and KES 0 stat cards.
  // A full per-section skeleton/error split isn't practical (many stats are
  // derived from combinations of these queries), so this takes the pragmatic
  // middle ground: a full-page skeleton until everything settles, then an
  // inline banner naming what failed rather than silently showing zeros.
  const dashboardQueries = [
    { isLoading: loadingMembers,      isError: errMembers,      error: membersErr },
    { isLoading: loadingContribs,     isError: errContribs,     error: contribsErr },
    { isLoading: loadingPendingLoans, isError: errPendingLoans, error: pendingLoansErr },
    { isLoading: loadingPool,         isError: errPool,         error: poolErr },
    { isLoading: loadingWelfare,      isError: errWelfare,      error: welfareErr },
    { isLoading: loadingUnrouted,     isError: errUnrouted,     error: unroutedErr },
    { isLoading: loadingNonContrib,   isError: errNonContrib,   error: nonContribErr },
    { isLoading: loadingTrialBalance, isError: errTrialBalance, error: trialBalanceErr },
    { isLoading: loadingExecSummary,  isError: errExecSummary,  error: execSummaryErr },
    { isLoading: loadingUpcoming,     isError: errUpcoming,     error: upcomingErr },
  ];
  const isDashboardLoading = dashboardQueries.some((q) => q.isLoading);
  const erroredDashboardQueries = dashboardQueries.filter((q) => q.isError);

  const totalMembers       = membersData?.total ?? 0;
  const recentContribs     = contributionsData?.items ?? [];
  const pendingLoanList    = pendingLoans?.items ?? [];
  const pendingWelfareList = pendingWelfare?.items ?? [];
  const unroutedList       = unrouted?.items ?? [];
  const welfareBalance     = poolData?.summary?.balance ?? 0;

  const cashBalance = Number(
    (trialBalance ?? []).find((l) => l.accountCode === '1001')?.netBalance ?? 0,
  );
  // 4005 External Funding — capital received from partner organizations
  // (income-type, so the trial balance already presents it as a positive).
  const externalFunding = Number(
    (trialBalance ?? []).find((l) => l.accountCode === '4005')?.netBalance ?? 0,
  );

  const taskCount =
    unroutedList.length + pendingLoanList.length + pendingWelfareList.length + (nonContrib?.count ?? 0);

  const totalSavings          = Number(execSummary?.contributions.totalAmount ?? 0);
  const outstandingLoans      = Number(execSummary?.loans.outstandingBalance ?? 0);
  // monthlyBuckets is ordered ASC over the trailing 12 months — the last
  // bucket is the current (possibly partial) calendar month.
  const thisMonthContribs     = Number(
    execSummary?.contributions.monthlyBuckets.at(-1)?.amount ?? 0,
  );
  const upcomingRepaymentList = upcomingRepayments ?? [];

  const quickActions: QuickAction[] = [
    { label: 'Record contribution', icon: ReceiptText, href: '/contributions', tint: 'bg-green-50 text-green-600' },
    { label: 'Disburse loan',       icon: Landmark,     href: '/loans',        tint: 'bg-blue-50 text-blue-600' },
    { label: 'Receive repayment',   icon: HandCoins,    href: '/loans',        tint: 'bg-blue-50 text-blue-600' },
    { label: 'Send money',          icon: Smartphone,   onClick: () => setStkOpen(true), tint: 'bg-purple-50 text-purple-600' },
    { label: 'Add member',          icon: UserPlus,     href: '/members',      tint: 'bg-amber-50 text-amber-600' },
    { label: 'Record welfare',      icon: Heart,        href: '/welfare',      tint: 'bg-red-50 text-red-600' },
  ];

  if (isDashboardLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title={user ? `Welcome back, ${user.firstName}` : 'Dashboard'}
        description={isTenantUser(user) ? user.groupName : 'Financial overview'}
        actions={
          <>
            {/* Opens the in-dashboard STK Push flow — no page navigation. */}
            <Button size="sm" className="gap-1.5 h-9" onClick={() => setStkOpen(true)}>
              <Smartphone size={15} /> Request payment
            </Button>
            <Link href="/contributions">
              <Button size="sm" variant="outline" className="gap-1.5 h-9">
                <Plus size={15} /> Record
              </Button>
            </Link>
          </>
        }
      />

      {erroredDashboardQueries.length > 0 && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Some dashboard data couldn&apos;t load — figures below may be incomplete. {getErrorMessage(erroredDashboardQueries[0].error)}
        </div>
      )}

      {/* Quick Actions */}
      <Card>
        <CardContent className="pt-5">
          <QuickActions actions={quickActions} />
        </CardContent>
      </Card>

      {/* Zone 1 — Needs you now */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertCircle size={16} className={taskCount > 0 ? 'text-orange-500' : 'text-green-500'} />
            Needs you now
            {taskCount > 0 && (
              <Badge variant="warning" className="ml-1">{taskCount}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {taskCount === 0 ? (
            <div className="flex flex-col items-center py-8 gap-2 text-center">
              <CheckCircle2 size={28} className="text-green-500" />
              <p className="text-sm text-muted-foreground">All clear — nothing needs your attention</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {unroutedList.length > 0 && (
                <TaskRow
                  icon={ReceiptText}
                  tone="amber"
                  count={unroutedList.length}
                  label={`unrouted M-Pesa receipt${unroutedList.length !== 1 ? 's' : ''} to allocate`}
                  preview={unroutedList.slice(0, 3).map(
                    (u) => `${u.receipt ?? 'Receipt'} — ${formatKES(u.amount ?? 0)}${u.phone ? ` · ${u.phone}` : ''}`,
                  )}
                  href="/mpesa/unrouted"
                  cta="Resolve"
                />
              )}
              {pendingLoanList.length > 0 && (
                <TaskRow
                  icon={Landmark}
                  tone="orange"
                  count={pendingLoanList.length}
                  label={`loan${pendingLoanList.length !== 1 ? 's' : ''} awaiting approval`}
                  preview={pendingLoanList.map(
                    (l) => `${l.member_name} — ${formatKES(l.principal_amount)}`,
                  )}
                  href="/loans"
                  cta="Review"
                />
              )}
              {pendingWelfareList.length > 0 && (
                <TaskRow
                  icon={Heart}
                  tone="red"
                  count={pendingWelfareList.length}
                  label={`welfare request${pendingWelfareList.length !== 1 ? 's' : ''} to review`}
                  preview={pendingWelfareList.map(
                    (w) => `${w.member_name} — ${w.title} (${formatKES(w.amount_requested)})`,
                  )}
                  href="/welfare"
                  cta="Review"
                />
              )}
              {(nonContrib?.count ?? 0) > 0 && (
                <TaskRow
                  icon={UserX}
                  tone="blue"
                  count={nonContrib!.count}
                  label="member(s) haven't contributed this month"
                  preview={nonContrib!.sample.map((m) => m.name)}
                  href="/contributions"
                  cta="Remind"
                />
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Zone 2 — Money at a glance */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/accounting" className="block group">
          <StatCard
            title="Cash / M-Pesa"
            value={formatKES(cashBalance)}
            icon={Wallet}
            className="transition-colors group-hover:border-primary/40"
          />
        </Link>
        <Link href="/welfare" className="block group">
          <StatCard
            title="Welfare fund"
            value={formatKES(welfareBalance)}
            description={`${pendingWelfareList.length} pending request${pendingWelfareList.length !== 1 ? 's' : ''}`}
            icon={Heart}
            className="transition-colors group-hover:border-primary/40"
          />
        </Link>
        <Link href="/treasury" className="block group">
          <StatCard
            title="External funding"
            value={formatKES(externalFunding)}
            description="From partner organizations"
            icon={Landmark}
            className="transition-colors group-hover:border-primary/40"
          />
        </Link>
        <Link href="/members" className="block group">
          <StatCard
            title="Members"
            value={String(totalMembers)}
            icon={Users}
            className="transition-colors group-hover:border-primary/40"
          />
        </Link>
        <Link href="/contributions" className="block group">
          <StatCard
            title="Total savings"
            value={formatKES(totalSavings)}
            description="All-time contributions"
            icon={PiggyBank}
            className="transition-colors group-hover:border-primary/40"
          />
        </Link>
        <Link href="/loans" className="block group">
          <StatCard
            title="Outstanding loans"
            value={formatKES(outstandingLoans)}
            icon={TrendingDown}
            className="transition-colors group-hover:border-primary/40"
          />
        </Link>
        <Link href="/contributions" className="block group">
          <StatCard
            title="This month's contributions"
            value={formatKES(thisMonthContribs)}
            icon={ReceiptText}
            className="transition-colors group-hover:border-primary/40"
          />
        </Link>
      </div>

      {/* Zone 2b — Upcoming loan repayments */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <CalendarClock size={16} className="text-muted-foreground" />
            <CardTitle className="text-base">Upcoming Loan Repayments</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {upcomingRepaymentList.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No repayments due</p>
          ) : (
            <div className="space-y-3">
              {upcomingRepaymentList.map((r) => (
                <div key={r.id} className="flex items-center justify-between text-sm">
                  <div>
                    <p className="font-medium">{r.member_name}</p>
                    <p className="text-xs text-muted-foreground">Due {formatDate(r.due_date)} · Installment #{r.installment_number}</p>
                  </div>
                  <p className="font-semibold">{formatKES(r.total_due)}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Zone 3 — Recent activity */}
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
              {recentContribs.map((c) => (
                <div key={c.id} className="flex items-center justify-between text-sm">
                  <div>
                    <p className="font-medium">{c.member_name ?? c.member_id}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(c.created_at)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-green-600">{formatKES(c.amount)}</p>
                    <StatusPill status={c.status} size="sm" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <StkPromptDialog open={stkOpen} onClose={() => setStkOpen(false)} />
    </div>
  );
}
