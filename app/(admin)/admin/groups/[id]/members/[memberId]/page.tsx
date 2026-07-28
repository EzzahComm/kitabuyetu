'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import {
  Wallet, TrendingUp, Landmark, Coins, Phone, Mail, Calendar, ShieldCheck, Activity,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { StatusPill } from '@/components/shared/status-pill';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdminMemberDetail } from '@/hooks/use-admin';
import { formatKES, formatDate } from '@/lib/utils';
import type { Tone } from '@/lib/ui/tokens';

// Same tier palette as app/(dashboard)/members/[id]/page.tsx and
// app/(dashboard)/credit-scores/page.tsx — kept as a small local const here
// too rather than a new shared module, matching how this codebase already
// tolerates this exact duplication in 3 other files.
type CreditTier = 'excellent' | 'good' | 'fair' | 'poor' | 'high_risk';
const TIER_TONE: Record<CreditTier, Tone> = {
  excellent: 'positive', good: 'positive', fair: 'neutral', poor: 'warning', high_risk: 'negative',
};
const TIER_LABEL: Record<CreditTier, string> = {
  excellent: 'Excellent', good: 'Good', fair: 'Fair', poor: 'Poor', high_risk: 'High risk',
};

const ACTIVITY_LABEL: Record<string, string> = {
  contribution: 'Contribution', loan_repayment: 'Loan repayment',
};

export default function AdminMemberDetailPage({
  params,
}: {
  params: Promise<{ id: string; memberId: string }>;
}) {
  const { id: groupId, memberId } = use(params);
  const router = useRouter();
  const { data: detail, isLoading } = useAdminMemberDetail(groupId, memberId);

  if (isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="text-center py-20">
        <p className="text-sm text-muted-foreground">Member not found</p>
        <Button variant="link" className="mt-2" onClick={() => router.back()}>← Go back</Button>
      </div>
    );
  }

  const { profile, snapshot, recentActivity, creditScore } = detail;

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${profile.first_name} ${profile.last_name}`}
        description={`${profile.group_name ?? 'No active group'}${profile.member_code ? ` · ${profile.member_code}` : ''}`}
        breadcrumbs={[
          { label: 'Groups', href: '/admin/groups' },
          { label: profile.group_name ?? 'Group', href: `/admin/groups/${groupId}` },
          { label: `${profile.first_name} ${profile.last_name}` },
        ]}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <StatusPill status={profile.is_active ? 'active' : 'inactive'} size="sm" />
          {profile.membership_status && (
            <StatusPill status={profile.membership_status} size="sm" label={`Membership: ${profile.membership_status}`} />
          )}
          {profile.platform_role && profile.platform_role !== 'member' && (
            <StatusPill status="info" tone="info" size="sm" label={profile.platform_role.replace('_', ' ')} />
          )}
        </div>
      </PageHeader>

      {/* Financial snapshot */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard title="Savings" value={formatKES(snapshot?.savings ?? 0)} icon={Wallet} iconClass="bg-green-50" />
        <StatCard title="Shares" value={formatKES(snapshot?.shares ?? 0)} icon={Coins} iconClass="bg-blue-50" />
        <StatCard title="Loan balance" value={formatKES(snapshot?.loanBalance ?? 0)} icon={Landmark} iconClass="bg-purple-50" />
        <StatCard title="This month" value={formatKES(snapshot?.contributedThisPeriod ?? 0)} icon={TrendingUp} iconClass="bg-amber-50" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Contact / profile */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ShieldCheck size={14} className="text-blue-500" /> Profile
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 text-xs">
            {profile.email && (
              <a href={`mailto:${profile.email}`} className="flex items-center gap-2 text-gray-600 hover:text-blue-600">
                <Mail size={12} /> {profile.email}
              </a>
            )}
            {profile.phone && (
              <a href={`tel:${profile.phone}`} className="flex items-center gap-2 text-gray-600 hover:text-blue-600">
                <Phone size={12} /> {profile.phone}
              </a>
            )}
            <div className="pt-2 border-t border-gray-100 grid grid-cols-2 gap-y-2">
              <div>
                <p className="text-gray-400 mb-0.5">Organization</p>
                <p className="font-medium text-gray-900">{profile.organization_name ?? '—'}</p>
              </div>
              <div>
                <p className="text-gray-400 mb-0.5">Group role</p>
                <p className="font-medium text-gray-900 capitalize">{profile.group_role?.replace('_', ' ') ?? '—'}</p>
              </div>
              <div>
                <p className="text-gray-400 mb-0.5 flex items-center gap-1"><Calendar size={10} /> Joined</p>
                <p className="font-medium text-gray-900">{profile.joined_at ? formatDate(profile.joined_at) : '—'}</p>
              </div>
              <div>
                <p className="text-gray-400 mb-0.5">Last login</p>
                <p className="font-medium text-gray-900">{profile.last_login_at ? formatDate(profile.last_login_at) : 'Never'}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Credit score */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ShieldCheck size={14} className="text-purple-500" /> Credit score
            </CardTitle>
          </CardHeader>
          <CardContent>
            {creditScore ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-2xl font-bold text-gray-900">{Number(creditScore.overall_score).toFixed(0)}</span>
                  <StatusPill
                    status={creditScore.reliability_tier}
                    tone={TIER_TONE[creditScore.reliability_tier as CreditTier]}
                    label={TIER_LABEL[creditScore.reliability_tier as CreditTier]}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-gray-400">Financial</p>
                    <p className="font-medium text-gray-900">{Number(creditScore.financial_score).toFixed(0)}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Social</p>
                    <p className="font-medium text-gray-900">{Number(creditScore.social_score).toFixed(0)}</p>
                  </div>
                </div>
                <div className="pt-2 border-t border-gray-100 flex justify-between text-xs">
                  <span className="text-gray-500">Loan eligibility limit</span>
                  <span className="font-semibold text-gray-900">{formatKES(creditScore.loan_eligibility_limit)}</span>
                </div>
                <p className="text-[11px] text-gray-400">Computed {formatDate(creditScore.computed_at)}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">No credit score computed yet</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent activity */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Activity size={14} className="text-gray-500" /> Recent activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentActivity.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No transactions yet</p>
          ) : (
            <div className="space-y-1">
              {recentActivity.map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-3 py-1.5 border-b border-gray-50 last:border-0 text-xs">
                  <span className="font-medium text-gray-700">{ACTIVITY_LABEL[row.type] ?? row.type}</span>
                  <StatusPill status={row.status} size="sm" />
                  <span className="font-mono text-gray-900">{formatKES(row.amount)}</span>
                  <span className="text-gray-400 shrink-0">{formatDate(row.date)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
