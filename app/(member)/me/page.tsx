'use client';

import * as React from 'react';
import Link from 'next/link';
import { HandCoins, Receipt, Target, FileText, ChevronRight, Megaphone, Landmark } from 'lucide-react';
import { WalletCard } from '@/components/member/wallet-card';
import { QuickActions, type QuickAction } from '@/components/member/quick-actions';
import { SavingsGoalCard } from '@/components/member/savings-goal-card';
import { PassbookRow } from '@/components/member/passbook-row';
import { MoneyActionDialog } from '@/components/shared/confirm-dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { formatKES, formatDate } from '@/lib/utils';
import { member, wallet, loan, goals, passbook, announcements } from '../_data';

type MoneyFlow = 'contribute' | 'repay' | null;

export default function MemberHomePage() {
  const [flow, setFlow] = React.useState<MoneyFlow>(null);
  const topGoal = goals[0];
  const recent = passbook.slice(0, 3);
  const announcement = announcements[0];

  const actions: QuickAction[] = [
    { label: 'Contribute', icon: HandCoins, tint: 'bg-brand-50 text-brand-600', onClick: () => setFlow('contribute') },
    { label: 'Pay loan', icon: Receipt, tint: 'bg-brand-blue-50 text-brand-blue-600', onClick: () => setFlow('repay') },
    { label: 'Goals', icon: Target, tint: 'bg-orange-50 text-orange-600', href: '/me/goals' },
    { label: 'Statement', icon: FileText, tint: 'bg-purple-50 text-purple-600', href: '/me/passbook' },
  ];

  return (
    <div className="space-y-5">
      <WalletCard
        savings={wallet.savings}
        shares={wallet.shares}
        thisMonth={wallet.thisMonth}
        loanBalance={wallet.loanBalance}
        memberNo={member.memberNo}
      />

      <QuickActions actions={actions} />

      {/* Loan repayment nudge */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-blue-50 text-brand-blue-600">
                <Landmark size={18} />
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">Loan balance</p>
                <p className="money text-xs text-muted-foreground">{formatKES(loan.balance)} remaining</p>
              </div>
            </div>
            <span className="rounded-full bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700">{loan.nextDueLabel}</span>
          </div>
          <Progress value={loan.progress} className="mt-3" />
          <p className="mt-2 text-xs text-muted-foreground">
            {loan.progress}% repaid · next payment <span className="money font-semibold text-foreground">{formatKES(loan.nextAmount)}</span>
          </p>
        </CardContent>
      </Card>

      {/* Top savings goal */}
      <section className="space-y-2">
        <SectionHeader title="Savings goal" href="/me/goals" />
        <SavingsGoalCard goal={topGoal} />
      </section>

      {/* Recent activity */}
      <section className="space-y-1">
        <SectionHeader title="Recent activity" href="/me/passbook" />
        <Card>
          <CardContent className="divide-y px-4 py-0">
            {recent.map((e) => <PassbookRow key={e.id} entry={e} />)}
          </CardContent>
        </Card>
      </section>

      {/* Announcement */}
      {announcement && (
        <Link href="/me/notifications" className="block">
          <div className="flex gap-3 rounded-2xl border border-brand-100 bg-brand-50/60 p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700">
              <Megaphone size={18} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{announcement.title}</p>
              <p className="line-clamp-2 text-xs text-muted-foreground">{announcement.body}</p>
              <p className="mt-1 text-[11px] text-muted-foreground/70">{announcement.author} · {formatDate(announcement.date)}</p>
            </div>
          </div>
        </Link>
      )}

      {/* Money flows — high-confidence confirmation before funds move */}
      <MoneyActionDialog
        open={flow === 'contribute'}
        onOpenChange={(o) => !o && setFlow(null)}
        title="Contribute via M-Pesa"
        amount={1000}
        details={[
          { label: 'To', value: member.groupName },
          { label: 'Type', value: 'Weekly contribution' },
          { label: 'Pay with', value: 'M-Pesa STK · +254 7•• ••• 345' },
        ]}
        confirmLabel="Send M-Pesa request"
        onConfirm={() => new Promise((r) => setTimeout(r, 1200))}
      />
      <MoneyActionDialog
        open={flow === 'repay'}
        onOpenChange={(o) => !o && setFlow(null)}
        title="Pay loan instalment"
        amount={loan.nextAmount}
        details={[
          { label: 'To', value: member.groupName },
          { label: 'Remaining after', value: formatKES(Math.max(0, loan.balance - loan.nextAmount)) },
          { label: 'Pay with', value: 'M-Pesa STK · +254 7•• ••• 345' },
        ]}
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
