'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Users, Heart, ArrowRight, AlertCircle, CheckCircle2,
  Landmark, ReceiptText, UserX, Wallet, Smartphone, Plus,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusPill } from '@/components/shared/status-pill';
import { Button } from '@/components/ui/button';
import { useMembers } from '@/hooks/use-members';
import { useContributions } from '@/hooks/use-contributions';
import { useLoans } from '@/hooks/use-loans';
import { useWelfareRequests, useWelfarePool } from '@/hooks/use-welfare';
import { useAuth, isTenantUser } from '@/lib/auth/context';
import { api } from '@/lib/api/client';
import { formatKES, formatDate } from '@/lib/utils';

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

function MoneyTile({ label, value, sub, href, icon: Icon }: {
  label: string; value: string; sub?: string; href: string; icon: React.ElementType;
}) {
  return (
    <Link href={href} className="block group">
      <Card className="transition-colors group-hover:border-primary/40">
        <CardContent className="pt-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase text-muted-foreground tracking-wide">{label}</p>
            <p className="mt-1 text-2xl font-bold">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
        </CardContent>
      </Card>
    </Link>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();

  const { data: membersData }       = useMembers({ page: 1, limit: 1 });
  const { data: contributionsData } = useContributions({ page: 1, limit: 5 });
  const { data: pendingLoans }      = useLoans({ page: 1, limit: 5, status: 'pending' });
  const { data: poolData }          = useWelfarePool();
  const { data: pendingWelfare }    = useWelfareRequests({ status: 'pending', limit: 5 });

  const { data: unrouted } = useQuery<{ items: { id: string; amount?: string; phone?: string; receipt?: string }[] }>({
    queryKey: ['dashboard', 'mpesa-unrouted'],
    queryFn:  () => api.get('/mpesa/unrouted'),
    staleTime: 30_000,
  });

  const { data: nonContrib } = useQuery<{ count: number; sample: { id: string; name: string }[] }>({
    queryKey: ['dashboard', 'non-contributors'],
    queryFn:  () => api.get('/contributions/non-contributors'),
    staleTime: 60_000,
  });

  const { data: trialBalance } = useQuery<{ accountCode: string; netBalance: string }[]>({
    queryKey: ['dashboard', 'trial-balance'],
    queryFn:  () => api.get('/accounting/reports?type=trial_balance'),
    staleTime: 60_000,
  });

  const totalMembers       = membersData?.total ?? 0;
  const recentContribs     = (contributionsData?.items ?? []) as any[];
  const pendingLoanList    = (pendingLoans?.items ?? []) as any[];
  const pendingWelfareList = (pendingWelfare?.items ?? []) as any[];
  const unroutedList       = unrouted?.items ?? [];
  const welfareBalance     = poolData?.summary?.balance ?? 0;

  const cashBalance = Number(
    (trialBalance ?? []).find((l) => l.accountCode === '1001')?.netBalance ?? 0,
  );

  const taskCount =
    unroutedList.length + pendingLoanList.length + pendingWelfareList.length + (nonContrib?.count ?? 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {user ? `Welcome back, ${user.firstName}` : 'Dashboard'}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {isTenantUser(user) ? user.groupName : 'Financial overview'}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href="/mpesa">
            <Button size="sm" className="gap-1.5 h-9">
              <Smartphone size={15} /> Request payment
            </Button>
          </Link>
          <Link href="/contributions">
            <Button size="sm" variant="outline" className="gap-1.5 h-9">
              <Plus size={15} /> Record
            </Button>
          </Link>
        </div>
      </div>

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
                    (l) => `${l.member_name ?? l.memberName} — ${formatKES(l.principal_amount ?? l.principalAmount)}`,
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
      <div className="grid gap-4 sm:grid-cols-3">
        <MoneyTile
          label="Cash / M-Pesa"
          value={formatKES(cashBalance)}
          sub="Available balance"
          href="/accounting"
          icon={Wallet}
        />
        <MoneyTile
          label="Welfare fund"
          value={formatKES(welfareBalance)}
          sub={`${pendingWelfareList.length} pending request${pendingWelfareList.length !== 1 ? 's' : ''}`}
          href="/welfare"
          icon={Heart}
        />
        <MoneyTile
          label="Members"
          value={String(totalMembers)}
          sub="Active group members"
          href="/members"
          icon={Users}
        />
      </div>

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
              {recentContribs.map((c: any) => (
                <div key={c.id} className="flex items-center justify-between text-sm">
                  <div>
                    <p className="font-medium">{c.member_name ?? c.memberName ?? c.member_id}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(c.created_at ?? c.createdAt)}</p>
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
    </div>
  );
}
