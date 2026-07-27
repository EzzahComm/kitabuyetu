'use client';

import dynamic from 'next/dynamic';
import {
  CreditCard, TrendingUp, AlertCircle,
  CheckCircle2, Clock, ArrowRight,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
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

const PAYMENT_STATUS_VARIANT: Record<string, 'success' | 'warning' | 'destructive' | 'secondary'> = {
  completed: 'success',
  pending:   'warning',
  failed:    'destructive',
  refunded:  'secondary',
};

const INVOICE_STATUS_VARIANT: Record<string, 'warning' | 'destructive' | 'success' | 'secondary'> = {
  pending:  'warning',
  overdue:  'destructive',
  paid:     'success',
  cancelled: 'secondary',
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
  const { data, isLoading } = useAdminBilling();

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
        {[
          {
            label: 'Monthly Recurring Revenue',
            value: isLoading ? null : formatKES(mrr),
            sub: `${summary.active_subscriptions ?? 0} active subscriptions`,
            color: 'text-green-600',
          },
          {
            label: 'Active Subscriptions',
            value: isLoading ? null : (summary.active_subscriptions ?? 0),
            sub: `${summary.trial_subscriptions ?? 0} on trial`,
            color: 'text-blue-600',
          },
          {
            label: 'Expired / At Risk',
            value: isLoading ? null : (summary.expired_subscriptions ?? 0),
            sub: 'Need renewal or follow-up',
            color: 'text-amber-600',
          },
          {
            label: 'Overdue Invoices',
            value: isLoading ? null : (summary.overdue_count ?? 0),
            sub: 'Outstanding balances',
            color: 'text-red-600',
          },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className="bg-white border border-gray-200 rounded-xl p-5">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
            {isLoading
              ? <Skeleton className="h-8 w-24 mt-2" />
              : <p className={`text-2xl font-bold mt-2 ${color}`}>{value}</p>
            }
            <p className="text-xs text-gray-400 mt-1">{sub}</p>
          </div>
        ))}
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
                      <Badge variant={INVOICE_STATUS_VARIANT[inv.status] ?? 'secondary'} className="text-[10px]">
                        {inv.status}
                      </Badge>
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
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Organization</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Invoice</th>
                  <th className="text-right text-xs font-semibold text-gray-500 uppercase px-4 py-3">Amount</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Method</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Status</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {isLoading ? (
                  [...Array(6)].map((_, i) => (
                    <tr key={i}>{[...Array(6)].map((__, j) => (
                      <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full max-w-[100px]" /></td>
                    ))}</tr>
                  ))
                ) : recentPayments.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-sm text-muted-foreground">No payments yet</td></tr>
                ) : recentPayments.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{p.group_name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs font-mono">{p.invoice_number ?? '—'}</td>
                    <td className="px-4 py-3 text-right font-semibold">{formatKES(p.amount)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500 capitalize">{p.payment_method?.replace('_', ' ') ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Badge variant={PAYMENT_STATUS_VARIANT[p.status] ?? 'secondary'} className="text-xs">
                        {p.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{formatDate(p.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
