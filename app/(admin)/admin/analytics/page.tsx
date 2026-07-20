'use client';

import dynamic from 'next/dynamic';
import { BarChart3, Building2, TrendingUp, Heart, Landmark } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdminAnalytics } from '@/hooks/use-admin';
import { formatKES } from '@/lib/utils';

// OPTIMIZATION_CLEANUP_AUDIT.md Medium #26 — recharts (~90KB gzipped) is
// code-split out of the initial bundle; it's only needed once data loads.
const GrowthChart = dynamic(() => import('./_charts').then((m) => m.GrowthChart), {
  ssr: false, loading: () => <Skeleton className="h-52 w-full" />,
});
const TopGroupsChart = dynamic(() => import('./_charts').then((m) => m.TopGroupsChart), {
  ssr: false, loading: () => <Skeleton className="h-52 w-full" />,
});

const GROUP_TYPE_COLORS: Record<string, string> = {
  chama:       '#3b82f6',
  sacco:       '#7c3aed',
  welfare:     '#f43f5e',
  investment:  '#10b981',
  organization_group:   '#f59e0b',
};

export default function AnalyticsPage() {
  const { data, isLoading } = useAdminAnalytics();

  const growth     = data?.growth     ?? [];
  const topGroups  = data?.topGroups  ?? [];
  const loanHealth = data?.loanHealth ?? {};
  const welfare    = data?.welfareStats ?? {};

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <BarChart3 size={20} className="text-blue-500" /> Platform Analytics
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Aggregate insights across all groups and financial activity
        </p>
      </div>

      {/* Growth chart — note: this tracks groups, not organizations (a
          distinct entity — see organizations count on the main dashboard) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Building2 size={14} className="text-blue-500" />
            Group Growth (12 months)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-52 w-full" />
          ) : growth.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">No growth data available</p>
          ) : (
            <GrowthChart data={growth} />
          )}
        </CardContent>
      </Card>

      {/* Loan health + Welfare stats */}
      <div className="grid gap-6 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Landmark size={14} className="text-blue-500" /> Loan Portfolio Health
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Active', value: loanHealth.active ?? 0, color: 'text-blue-600 bg-blue-50' },
                    { label: 'Defaulted', value: loanHealth.defaulted ?? 0, color: 'text-red-600 bg-red-50' },
                    { label: 'Completed', value: loanHealth.completed ?? 0, color: 'text-green-600 bg-green-50' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className={`rounded-xl p-3 text-center ${color.split(' ')[1]}`}>
                      <p className={`text-xl font-bold ${color.split(' ')[0]}`}>{parseInt(value).toLocaleString()}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>
                <div className="pt-2 border-t border-gray-100 space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Total Outstanding</span>
                    <span className="font-semibold text-gray-900">{formatKES(loanHealth.total_outstanding ?? 0)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Avg Interest Rate</span>
                    <span className="font-semibold text-gray-900">{parseFloat(loanHealth.avg_interest_rate ?? '0').toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Default Rate</span>
                    <span className={`font-semibold ${parseInt(loanHealth.defaulted ?? '0') > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {(parseInt(loanHealth.active ?? '1') > 0
                        ? (parseInt(loanHealth.defaulted ?? '0') / (parseInt(loanHealth.active ?? '1') + parseInt(loanHealth.defaulted ?? '0'))) * 100
                        : 0
                      ).toFixed(1)}%
                    </span>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Heart size={14} className="text-red-500" /> Welfare Fund Overview
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-red-50 p-3 text-center">
                    <p className="text-xl font-bold text-red-600">
                      {parseInt(welfare.total_requests ?? '0').toLocaleString()}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">Total Requests</p>
                  </div>
                  <div className="rounded-xl bg-amber-50 p-3 text-center">
                    <p className="text-xl font-bold text-amber-600">
                      {parseInt(welfare.pending_requests ?? '0').toLocaleString()}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">Pending</p>
                  </div>
                </div>
                <div className="pt-2 border-t border-gray-100 space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Total Requested</span>
                    <span className="font-semibold">{formatKES(welfare.total_requested ?? 0)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Total Disbursed</span>
                    <span className="font-semibold text-green-600">{formatKES(welfare.total_disbursed ?? 0)}</span>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top groups by contributions */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <TrendingUp size={14} className="text-green-500" />
            Top Groups by Contributions
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-52 w-full" />
          ) : topGroups.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No data available</p>
          ) : (
            <TopGroupsChart data={topGroups} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
