'use client';

import { Users, TrendingUp, Landmark, DollarSign } from 'lucide-react';
import { StatCard } from '@/components/shared/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useMembers } from '@/hooks/use-members';
import { useContributions } from '@/hooks/use-contributions';
import { useLoans } from '@/hooks/use-loans';
import { formatKES, formatDate } from '@/lib/utils';

export default function DashboardPage() {
  // Use `limit` (not `pageSize`) — matches ContributionQuerySchema / LoanQuerySchema / MemberQuerySchema
  const { data: membersData }       = useMembers({ page: 1, limit: 1 });
  const { data: contributionsData } = useContributions({ page: 1, limit: 5 });
  const { data: loansData }         = useLoans({ page: 1, limit: 5, status: 'active' });

  const totalMembers   = membersData?.total ?? 0;
  const recentContribs = (contributionsData?.items ?? []) as any[];
  const activeLoans    = (loansData?.items ?? []) as any[];

  // API returns raw DB rows (snake_case). DB DECIMAL columns come back as strings.
  const contribTotal = recentContribs.reduce(
    (sum: number, c: any) => sum + parseFloat(c.amount ?? '0'),
    0,
  );
  const portfolioTotal = activeLoans.reduce(
    (sum: number, l: any) => sum + parseFloat(l.principal_amount ?? '0'),
    0,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground text-sm">Overview of your group&apos;s financial activity</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total Members"       value={totalMembers}           icon={Users}       description="Active group members" />
        <StatCard title="Active Loans"        value={activeLoans.length}     icon={Landmark}    description="Loans currently disbursed" />
        <StatCard title="This Month Contribs" value={formatKES(contribTotal)}  icon={TrendingUp} />
        <StatCard title="Loan Portfolio"      value={formatKES(portfolioTotal)} icon={DollarSign} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Contributions</CardTitle>
          </CardHeader>
          <CardContent>
            {recentContribs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No contributions yet</p>
            ) : (
              <div className="space-y-3">
                {recentContribs.map((c: any) => (
                  <div key={c.id} className="flex items-center justify-between text-sm">
                    <div>
                      {/* DB returns snake_case: member_name, created_at */}
                      <p className="font-medium">{c.member_name ?? c.member_id}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(c.created_at)}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-green-600">{formatKES(c.amount)}</p>
                      {/* ContributionStatus uses 'completed', not 'confirmed' */}
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

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Active Loans</CardTitle>
          </CardHeader>
          <CardContent>
            {activeLoans.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No active loans</p>
            ) : (
              <div className="space-y-3">
                {activeLoans.map((l: any) => (
                  <div key={l.id} className="flex items-center justify-between text-sm">
                    <div>
                      {/* DB returns snake_case: member_name, loan_term_months, interest_rate */}
                      <p className="font-medium">{l.member_name ?? l.member_id}</p>
                      <p className="text-xs text-muted-foreground">{l.loan_term_months}m @ {l.interest_rate}%</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{formatKES(l.principal_amount)}</p>
                      <p className="text-xs text-muted-foreground">
                        Balance: {formatKES(l.outstanding_balance ?? l.principal_amount)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
