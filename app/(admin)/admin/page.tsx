'use client';

import { useRouter } from 'next/navigation';
import {
  Building2, Users, CreditCard, TrendingUp,
  Headphones, AlertTriangle, CheckCircle2,
  ArrowRight, Clock, Circle,
} from 'lucide-react';
import { MetricCard } from '@/components/admin/metric-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { StatCard } from '@/components/shared/stat-card';
import { Skeleton } from '@/components/ui/skeleton';
import dynamic from 'next/dynamic';
import { useAdminDashboard, useAdminRevenueTrend } from '@/hooks/use-admin';

// Lazy-load Recharts so the ~360 KB library stays out of the dashboard's
// first-load bundle and only downloads when the chart actually renders.
const RevenueChart = dynamic(() => import('./_revenue-chart'), {
  ssr: false,
  loading: () => <div className="h-[200px] w-full animate-pulse rounded bg-gray-100" />,
});
import { formatKES, formatDate } from '@/lib/utils';
import Link from 'next/link';

function ActivityDot({ action }: { action: string }) {
  const map: Record<string, string> = {
    INSERT: 'bg-green-500',
    UPDATE: 'bg-blue-500',
    DELETE: 'bg-red-500',
  };
  return <span className={`inline-block w-2 h-2 rounded-full ${map[action] ?? 'bg-gray-400'}`} />;
}

function StatusRow({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${color}`} />
        <span className="text-sm text-gray-600">{label}</span>
      </div>
      <span className="text-sm font-semibold text-gray-900">{value}</span>
    </div>
  );
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const { data: stats, isLoading } = useAdminDashboard();
  const { data: trend }            = useAdminRevenueTrend();

  const g = stats?.groups        ?? {};
  const o = stats?.organizations ?? {};
  const m = stats?.members       ?? {};
  const s = stats?.subscriptions ?? {};
  const r = stats?.revenue       ?? {};
  const t = stats?.tickets       ?? {};

  const mrr = parseFloat(s.mrr ?? '0');

  return (
    <div className="space-y-6">
      {/* Page header */}
      <PageHeader
        title="Platform Overview"
        description="Real-time operational intelligence across all organizations"
        actions={
          <>
            <Link href="/admin/organizations">
              <Button variant="outline" size="sm" className="text-xs">
                Organizations <ArrowRight size={12} className="ml-1" />
              </Button>
            </Link>
            <Link href="/admin/groups">
              <Button variant="outline" size="sm" className="text-xs">
                Groups <ArrowRight size={12} className="ml-1" />
              </Button>
            </Link>
            <Link href="/admin/support">
              <Button size="sm" className="text-xs bg-blue-600 hover:bg-blue-700">
                Support Center
              </Button>
            </Link>
          </>
        }
      />

      {/* Primary KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Groups"
          value={isLoading ? '—' : (parseInt(g.total ?? '0')).toLocaleString()}
          sub={`${g.active ?? 0} active · ${g.new_this_month ?? 0} new this month`}
          icon={Building2}
          accent="blue"
          loading={isLoading}
          onClick={() => router.push('/admin/groups')}
        />
        <MetricCard
          title="Total Members"
          value={isLoading ? '—' : parseInt(m.total ?? '0').toLocaleString()}
          sub={`${m.new_this_month ?? 0} joined this month`}
          icon={Users}
          accent="purple"
          loading={isLoading}
          onClick={() => router.push('/admin/users')}
        />
        <MetricCard
          title="Monthly Revenue"
          value={isLoading ? '—' : formatKES(mrr)}
          sub={`${s.active_subscriptions ?? 0} active subscriptions`}
          icon={CreditCard}
          accent="green"
          loading={isLoading}
          onClick={() => router.push('/admin/billing-admin')}
        />
        <MetricCard
          title="Platform Revenue"
          value={isLoading ? '—' : formatKES(parseFloat(r.this_month ?? '0'))}
          sub={`${formatKES(parseFloat(r.this_week ?? '0'))} this week`}
          icon={TrendingUp}
          accent="orange"
          loading={isLoading}
        />
      </div>

      {/* Secondary KPIs */}
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        <button
          type="button"
          onClick={() => router.push('/admin/organizations')}
          className="bg-white border border-gray-200 rounded-xl p-4 text-left hover:border-blue-300 transition-colors"
        >
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Organizations</p>
          <p className="text-2xl font-bold text-gray-900 mt-2">{o.total ?? 0}</p>
          <p className="text-xs text-gray-500 mt-1">{o.active ?? 0} active · {o.new_this_month ?? 0} new</p>
        </button>
        <StatCard
          title="Active Subs"
          value={s.active_subscriptions ?? 0}
          description={`${s.trial_subscriptions ?? 0} on trial`}
          icon={CreditCard}
          iconClass="bg-blue-50"
        />
        <StatCard
          title="At Risk"
          value={s.at_risk ?? 0}
          description="Expired or suspended"
          icon={AlertTriangle}
          className="border-amber-200"
          iconClass="bg-amber-50"
        />
        <StatCard
          title="Open Tickets"
          value={t.open ?? 0}
          description={`${t.sla_breached ?? 0} SLA breached`}
          icon={Headphones}
          className="border-red-200"
          iconClass="bg-red-50"
        />
        <StatCard
          title="Suspended Groups"
          value={g.suspended ?? 0}
          description="Require review"
          icon={Building2}
          iconClass="bg-gray-100"
        />
      </div>

      {/* Charts + Activity row */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Revenue chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-900">Revenue Trend (6 months)</CardTitle>
          </CardHeader>
          <CardContent>
            {!trend || trend.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
                No revenue data yet
              </div>
            ) : (
              <RevenueChart data={trend} />
            )}
          </CardContent>
        </Card>

        {/* Subscription breakdown */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-900">Subscription Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <StatusRow label="Active"    value={s.active_subscriptions ?? 0} color="bg-green-500" />
            <StatusRow label="Trial"     value={s.trial_subscriptions  ?? 0} color="bg-blue-400" />
            <StatusRow label="Expired"   value={s.expired_subscriptions ?? 0} color="bg-gray-400" />
            <StatusRow label="At Risk"   value={s.at_risk ?? 0}               color="bg-amber-400" />
            <div className="pt-3 border-t border-gray-100 mt-2">
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Monthly Recurring Revenue</span>
                <span className="font-bold text-green-600">{formatKES(mrr)}</span>
              </div>
              <div className="flex justify-between text-xs mt-1">
                <span className="text-gray-500">Overdue invoices</span>
                <span className="font-bold text-red-500">{s.overdue_count ?? 0}</span>
              </div>
            </div>
            <Link href="/admin/billing-admin" className="block pt-2">
              <Button variant="outline" size="sm" className="w-full text-xs">
                Billing Center <ArrowRight size={11} className="ml-1" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Recent activity + support tickets */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent activity */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">Recent Activity</CardTitle>
              <Link href="/admin/audit-logs">
                <Button variant="ghost" size="sm" className="text-xs h-7">
                  View all <ArrowRight size={11} className="ml-1" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="flex gap-3">
                    <Skeleton className="w-2 h-2 rounded-full mt-1.5" />
                    <div className="flex-1 space-y-1">
                      <Skeleton className="h-3 w-3/4" />
                      <Skeleton className="h-2.5 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (stats?.recentActivity ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No recent activity</p>
            ) : (
              <div className="space-y-2.5">
                {(stats?.recentActivity ?? []).map((a, i) => (
                  <div key={i} className="flex items-start gap-2.5 text-xs">
                    <ActivityDot action={a.action} />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-gray-900 capitalize">{a.action.toLowerCase()}</span>
                      {' '}
                      <span className="text-gray-500">{a.table_name}</span>
                      {a.group_name && (
                        <span className="text-gray-400"> · {a.group_name}</span>
                      )}
                    </div>
                    <span className="text-gray-400 shrink-0">{formatDate(a.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Support tickets summary */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Headphones size={14} className="text-blue-500" />
                Support Queue
              </CardTitle>
              <Link href="/admin/support">
                <Button variant="ghost" size="sm" className="text-xs h-7">
                  Open Center <ArrowRight size={11} className="ml-1" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {/* Ticket stats */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Open',        value: t.open        ?? 0, color: 'text-blue-600',  bg: 'bg-blue-50' },
                  { label: 'In Progress', value: t.in_progress ?? 0, color: 'text-amber-600', bg: 'bg-amber-50' },
                  { label: 'SLA Breach',  value: t.sla_breached ?? 0, color: 'text-red-600', bg: 'bg-red-50' },
                ].map(({ label, value, color, bg }) => (
                  <div key={label} className={`${bg} rounded-lg p-3 text-center`}>
                    <p className={`text-lg font-bold ${color}`}>{value}</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">{label}</p>
                  </div>
                ))}
              </div>

              {/* Alerts */}
              {(parseInt(t.sla_breached ?? '0') > 0) && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <AlertTriangle size={14} className="text-red-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-red-800">
                      {t.sla_breached} ticket{parseInt(t.sla_breached) !== 1 ? 's' : ''} breached SLA
                    </p>
                    <p className="text-xs text-red-600 mt-0.5">Immediate attention required</p>
                  </div>
                </div>
              )}
              {parseInt(t.sla_breached ?? '0') === 0 && parseInt(t.open ?? '0') === 0 && (
                <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <CheckCircle2 size={14} className="text-green-600" />
                  <p className="text-xs font-semibold text-green-800">All tickets resolved — queue clear</p>
                </div>
              )}

              <Link href="/admin/support">
                <Button className="w-full text-xs bg-blue-600 hover:bg-blue-700 h-8">
                  Manage Support Queue
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
