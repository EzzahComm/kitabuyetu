'use client';

import dynamic from 'next/dynamic';
import {
  CreditCard, AlertCircle,
  CheckCircle2, Clock,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { PaginatedTable, singlePage } from '@/components/shared/paginated-table';
import { StatCard } from '@/components/shared/stat-card';
import { StatusPill } from '@/components/shared/status-pill';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdminBilling } from '@/hooks/use-admin';
import { formatKES, formatDate } from '@/lib/utils';

// OPTIMIZATION_CLEANUP_AUDIT.md Medium #26 — code-split recharts out of the
// initial bundle for this rarely-visited admin page.
const RevenueByPlanChart = dynamic(
  () => import('./_charts').then((m) => m.RevenueByPlanChart),
  { ssr: false, loading: () => <Skeleton className="h-52 w-full" /> },
);

const PLAN_COLORS: Record<string, string> = {
  starter:    '#94a3b8',
  growth:     '#3b82f6',
  enterprise: '#7c3aed',
};

interface BillingSummary {
  active_subscriptions:  number;
  expired_subscriptions: number;
  trial_subscriptions:   number;
  mrr:                   string;
  overdue_count:         number;
}

interface PlanRevenueRow { plan: string; count: string; revenue: string }

interface OutstandingInvoiceRow {
  id: string; invoice_number: string; amount_due: string;
  due_date: string; status: string; is_overdue: boolean; group_name: string | null;
}

interface RecentPaymentRow {
  id: string; amount: string; status: string; payment_method: string | null;
  created_at: string; group_name: string | null; invoice_number: string | null;
}

export default function BillingAdminPage() {
  const { data, isLoading, isError, error } = useAdminBilling();

  const summary: Partial<BillingSummary> = data?.summary        ?? {};
  const byPlan: PlanRevenueRow[]          = data?.byPlan         ?? [];
  const recentPayments: RecentPaymentRow[] = data?.recentPayments ?? [];
  const outstanding: OutstandingInvoiceRow[] = data?.outstanding    ?? [];

  const mrr = parseFloat(summary.mrr ?? '0');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing Operations"
        description="Subscription management, revenue tracking, and invoice oversight"
      />

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Monthly Recurring Revenue"
          value={isLoading ? '—' : formatKES(mrr)}
          description={`${summary.active_subscriptions ?? 0} active subscriptions`}
          icon={CreditCard}
          className="border-green-200"
          iconClass="bg-green-50"
        />
        <StatCard
          title="Active Subscriptions"
          value={isLoading ? '—' : (summary.active_subscriptions ?? 0)}
          description={`${summary.trial_subscriptions ?? 0} on trial`}
          icon={CheckCircle2}
          className="border-blue-200"
          iconClass="bg-blue-50"
        />
        <StatCard
          title="Expired / At Risk"
          value={isLoading ? '—' : (summary.expired_subscriptions ?? 0)}
          description="Need renewal or follow-up"
          icon={Clock}
          className="border-amber-200"
          iconClass="bg-amber-50"
        />
        <StatCard
          title="Overdue Invoices"
          value={isLoading ? '—' : (summary.overdue_count ?? 0)}
          description="Outstanding balances"
          icon={AlertCircle}
          className="border-red-200"
          iconClass="bg-red-50"
        />
      </div>

      {/* Plan distribution chart + outstanding invoices */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Plan bar chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Revenue by Plan</CardTitle>
          </CardHeader>
          <CardContent>
            {byPlan.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No subscription data</p>
            ) : (
              <RevenueByPlanChart data={byPlan} colors={PLAN_COLORS} />
            )}
            <div className="mt-3 space-y-1.5">
              {byPlan.map((p) => (
                <div key={p.plan} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ background: PLAN_COLORS[p.plan] }} />
                    <span className="capitalize text-gray-600 font-medium">{p.plan}</span>
                  </div>
                  <div className="flex items-center gap-4 text-gray-500">
                    <span>{p.count} org{parseInt(p.count) !== 1 ? 's' : ''}</span>
                    <span className="font-semibold text-gray-900">{formatKES(p.revenue)}/mo</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Outstanding invoices */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <AlertCircle size={14} className="text-amber-500" /> Outstanding Invoices
              </CardTitle>
              <span className="text-xs text-gray-500">{outstanding.length} unpaid</span>
            </div>
          </CardHeader>
          <CardContent>
            {outstanding.length === 0 ? (
              <div className="flex flex-col items-center py-8 gap-2 text-center">
                <CheckCircle2 size={24} className="text-green-500" />
                <p className="text-sm text-muted-foreground">No outstanding invoices</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {outstanding.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between p-2.5 rounded-lg border border-gray-100 hover:bg-gray-50">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{inv.group_name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-gray-400">{inv.invoice_number}</span>
                        <span className="text-xs text-gray-400">·</span>
                        <span className={`text-xs ${new Date(inv.due_date) < new Date() ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                          Due {formatDate(inv.due_date)}
                        </span>
                      </div>
                    </div>
                    <div className="text-right ml-3 shrink-0">
                      <p className="text-sm font-bold text-gray-900">{formatKES(inv.amount_due)}</p>
                      <StatusPill status={inv.status} size="sm" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent payments table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Recent Payments</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <PaginatedTable
            data={singlePage(recentPayments)}
            isLoading={isLoading}
            isError={isError}
            error={error}
            onPageChange={() => {}}
            emptyMessage="No payments yet"
            columns={[
              { key: 'group_name', header: 'Organization', render: (p) => <span className="font-medium text-gray-900">{p.group_name ?? '—'}</span> },
              { key: 'invoice_number', header: 'Invoice', render: (p) => <span className="text-gray-500 text-xs font-mono">{p.invoice_number ?? '—'}</span> },
              { key: 'amount', header: 'Amount', className: 'text-right', render: (p) => <span className="font-semibold">{formatKES(p.amount)}</span> },
              { key: 'payment_method', header: 'Method', render: (p) => <span className="text-xs text-gray-500 capitalize">{p.payment_method?.replace('_', ' ') ?? '—'}</span> },
              {
                key: 'status', header: 'Status',
                render: (p) => <StatusPill status={p.status} size="sm" />,
              },
              { key: 'created_at', header: 'Date', render: (p) => <span className="text-xs text-gray-500">{formatDate(p.created_at)}</span> },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
