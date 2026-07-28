'use client';

import * as React from 'react';
import Link from 'next/link';
import { HandCoins, Receipt, Target, FileText, ChevronRight, Bell, Landmark, AlertCircle } from 'lucide-react';
import { WalletCard } from '@/components/member/wallet-card';
import { QuickActions, type QuickAction } from '@/components/member/quick-actions';
import { SavingsGoalCard } from '@/components/member/savings-goal-card';
import { PassbookRow } from '@/components/member/passbook-row';
import { MoneyActionDialog } from '@/components/shared/confirm-dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { EmptyState } from '@/components/ui/empty-state';
import { ListSkeleton } from '@/components/shared/skeletons';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth, isTenantUser } from '@/lib/auth/context';
import { useMyWallet, useMyGoals, useMyPassbook, useMyNotifications } from '@/hooks/use-member';
import { formatKES, formatDateTime, getErrorMessage } from '@/lib/utils';

type MoneyFlow = 'contribute' | 'repay' | null;

export default function MemberHomePage() {
  const { user } = useAuth();
  const [flow, setFlow] = React.useState<MoneyFlow>(null);

  const wallet = useMyWallet();
  const goals = useMyGoals();
  const passbook = useMyPassbook({ limit: 3 });
  const notifications = useMyNotifications({ limit: 1 });

  const memberNo = isTenantUser(user) ? user.membershipNo : undefined;
  const groupName = isTenantUser(user) ? user.groupName : undefined;

  const topGoal = goals.data?.[0];
  const recent = passbook.data?.items ?? [];
  const latestNotification = notifications.data?.items[0];
  const activeLoan = wallet.data?.activeLoan;

  const actions: QuickAction[] = [
    { label: 'Contribute', icon: HandCoins, tint: 'bg-brand-50 text-brand-600', onClick: () => setFlow('contribute') },
    ...(activeLoan
      ? [{ label: 'Pay loan', icon: Receipt, tint: 'bg-brand-blue-50 text-brand-blue-600', onClick: () => setFlow('repay') } as QuickAction]
      : []),
    { label: 'Goals', icon: Target, tint: 'bg-orange-50 text-orange-600', href: '/me/goals' },
    { label: 'Statement', icon: FileText, tint: 'bg-purple-50 text-purple-600', href: '/me/passbook' },
  ];

  if (wallet.isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-16 w-full rounded-2xl" />
        <ListSkeleton rows={3} />
      </div>
    );
  }

  if (wallet.isError || !wallet.data) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="Could not load your account"
        description={getErrorMessage(wallet.error)}
      />
    );
  }

  return (
    <div className="space-y-5">
      <WalletCard
        savings={wallet.data.savings}
        shares={wallet.data.shares}
        thisMonth={wallet.data.thisMonth}
        loanBalance={wallet.data.loanBalance}
        memberNo={memberNo ?? '—'}
      />

      <QuickActions actions={actions} />

      {/* Loan repayment nudge — only shown when there's an active loan */}
      {activeLoan && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-blue-50 text-brand-blue-600">
                  <Landmark size={18} />
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground">Loan balance</p>
                  <p className="money text-xs text-muted-foreground">{formatKES(activeLoan.balance)} remaining</p>
                </div>
              </div>
              <span className="rounded-full bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700">{activeLoan.nextDueLabel}</span>
            </div>
            <Progress value={activeLoan.progress} className="mt-3" />
            <p className="mt-2 text-xs text-muted-foreground">
              {activeLoan.progress}% repaid · next payment <span className="money font-semibold text-foreground">{formatKES(activeLoan.nextAmount)}</span>
            </p>
          </CardContent>
        </Card>
      )}

      {/* Top savings goal */}
      <section className="space-y-2">
        <SectionHeader title="Savings goal" href="/me/goals" />
        {goals.isLoading ? (
          <Skeleton className="h-20 w-full rounded-2xl" />
        ) : topGoal ? (
          <SavingsGoalCard goal={topGoal} />
        ) : (
          <Link href="/me/goals" className="block rounded-2xl border border-dashed p-4 text-center text-sm text-muted-foreground hover:bg-muted/40">
            Set your first savings goal
          </Link>
        )}
      </section>

      {/* Recent activity */}
      <section className="space-y-1">
        <SectionHeader title="Recent activity" href="/me/passbook" />
        {passbook.isLoading ? (
          <ListSkeleton rows={3} />
        ) : recent.length === 0 ? (
          <p className="px-1 text-sm text-muted-foreground">No transactions yet.</p>
        ) : (
          <Card>
            <CardContent className="divide-y px-4 py-0">
              {recent.map((e) => <PassbookRow key={e.id} entry={e} />)}
            </CardContent>
          </Card>
        )}
      </section>

      {/* Latest notification */}
      {latestNotification && (
        <Link href="/me/notifications" className="block">
          <div className="flex gap-3 rounded-2xl border border-brand-100 bg-brand-50/60 p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700">
              <Bell size={18} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{latestNotification.title}</p>
              <p className="line-clamp-2 text-xs text-muted-foreground">{latestNotification.body}</p>
              <p className="mt-1 text-[11px] text-muted-foreground/70">{formatDateTime(latestNotification.createdAt)}</p>
            </div>
          </div>
        </Link>
      )}

      {/* Money flows — preview only for now, see warning copy below */}
      <MoneyActionDialog
        open={flow === 'contribute'}
        onOpenChange={(o) => !o && setFlow(null)}
        title="Contribute via M-Pesa"
        amount={1000}
        details={[
          { label: 'To', value: groupName ?? 'your group' },
          { label: 'Type', value: 'Contribution' },
        ]}
        warning="Preview only — this doesn't move money yet. Contact your treasurer to record a real payment."
        confirmLabel="Send M-Pesa request"
        onConfirm={() => new Promise((r) => setTimeout(r, 1200))}
      />
      <MoneyActionDialog
        open={flow === 'repay'}
        onOpenChange={(o) => !o && setFlow(null)}
        title="Pay loan instalment"
        amount={activeLoan?.nextAmount ?? 0}
        details={[
          { label: 'To', value: groupName ?? 'your group' },
          { label: 'Remaining after', value: formatKES(Math.max(0, (activeLoan?.balance ?? 0) - (activeLoan?.nextAmount ?? 0))) },
        ]}
        warning="Preview only — this doesn't move money yet. Contact your treasurer to record a real payment."
        confirmLabel="Pay now"
        onConfirm={() => new Promise((r) => setTimeout(r, 1200))}
      />
    </div>
  );
}

function SectionHeader({ title, href }: { title: string; href: string }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <Link href={href} className="flex items-center text-xs font-medium text-brand-600">
        See all <ChevronRight size={14} />
      </Link>
    </div>
  );
}
